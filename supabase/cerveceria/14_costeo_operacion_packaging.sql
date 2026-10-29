-- =============================================================================
-- 14. Costeo completo: operación del lote y envasado por formato
-- =============================================================================
--
-- QUÉ FALTABA
-- El costeo de una receta hoy suma los insumos y nada más. La planilla de COVEN
-- costea además lo que cuesta HACER el lote (mano de obra, electricidad, agua,
-- CO₂, limpieza, overhead) y lo que cuesta ENVASARLO en cada formato (envase,
-- tapa, etiqueta, caja y la mano de obra de la envasadora). Sin esos dos
-- bloques el precio sugerido sale de un costo que es ~73 % del real.
--
-- QUÉ DEJA
--   · `receta_costos_operacion`: las líneas de costo del lote. Es una tabla de
--     líneas y no columnas fijas porque cada cervecería carga conceptos
--     distintos; con columnas habría que migrar el schema para agregar uno.
--   · Columnas de envasado en `receta_formatos`.
--   · `costeo_parametros`: lo que es de la empresa y no de una receta (la
--     tarifa hora y los márgenes objetivo por canal).
--
-- El CÁLCULO no está acá: vive en `src/lib/recetas/costeo-completo.ts`, que es
-- una función pura con tests. Postgres guarda los números, no la fórmula.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Parámetros de la empresa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.costeo_parametros (
  empresa_id uuid PRIMARY KEY REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  /** Tarifa de la mano de obra de envasado. La de elaboración va como línea
      de operación, porque se mide en horas por lote y no por unidad. */
  tarifa_mo_hora_gs      numeric NOT NULL DEFAULT 0 CHECK (tarifa_mo_hora_gs >= 0),
  /** Márgenes objetivo por canal. Son escenarios, no reglas de mercado. */
  margen_mayorista_pct   numeric NOT NULL DEFAULT 0.40
    CHECK (margen_mayorista_pct >= 0 AND margen_mayorista_pct < 1),
  margen_directo_pct     numeric NOT NULL DEFAULT 0.45
    CHECK (margen_directo_pct >= 0 AND margen_directo_pct < 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cerveceriaerp.costeo_parametros IS
  'Parámetros de costeo que son de la empresa y no de una receta: tarifa hora de envasado y márgenes objetivo por canal.';

-- ---------------------------------------------------------------------------
-- 2. Costos de operación del lote
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.receta_costos_operacion (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id  uuid NOT NULL REFERENCES cerveceriaerp.recetas(id)  ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  categoria  text NOT NULL,
  concepto   text NOT NULL,
  /** Costo del concepto para UN lote completo, no por litro ni por unidad. */
  monto_gs   numeric NOT NULL DEFAULT 0 CHECK (monto_gs >= 0),
  nota       text,
  orden      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receta_costos_operacion_categoria_check
    CHECK (categoria = ANY (ARRAY['mano_obra','energia','otros']))
);

CREATE INDEX IF NOT EXISTS idx_receta_costos_operacion_receta
  ON cerveceriaerp.receta_costos_operacion (receta_id, orden);

COMMENT ON TABLE cerveceriaerp.receta_costos_operacion IS
  'Líneas de costo de hacer un lote: mano de obra, energía y otros (agua, CO₂, CIP, overhead). El monto es por lote completo.';

-- ---------------------------------------------------------------------------
-- 3. Envasado por formato
-- ---------------------------------------------------------------------------
-- Cada costo va en su propia columna y no sumado en una sola: cuando hay que
-- revisar un precio, lo primero que se pregunta es cuánto sale la lata y
-- cuánto la etiqueta.
ALTER TABLE cerveceriaerp.receta_formatos
  ADD COLUMN IF NOT EXISTS costo_envase   numeric NOT NULL DEFAULT 0 CHECK (costo_envase   >= 0),
  ADD COLUMN IF NOT EXISTS costo_tapa     numeric NOT NULL DEFAULT 0 CHECK (costo_tapa     >= 0),
  ADD COLUMN IF NOT EXISTS costo_etiqueta numeric NOT NULL DEFAULT 0 CHECK (costo_etiqueta >= 0),
  ADD COLUMN IF NOT EXISTS costo_pack     numeric NOT NULL DEFAULT 0 CHECK (costo_pack     >= 0),
  /** Unidades por hora de la envasadora y gente que la opera: de ahí sale la
      mano de obra de envasado, que es por formato y no por lote. */
  ADD COLUMN IF NOT EXISTS velocidad_unid_hora numeric
    CHECK (velocidad_unid_hora IS NULL OR velocidad_unid_hora > 0),
  ADD COLUMN IF NOT EXISTS operarios integer NOT NULL DEFAULT 1 CHECK (operarios >= 0),
  /** Qué fracción del lote llega a la unidad vendida en ESTE formato: lo que
      se pierde en la línea de envasado (espuma, purgas, descarte). */
  ADD COLUMN IF NOT EXISTS rendimiento_packaging numeric NOT NULL DEFAULT 1
    CHECK (rendimiento_packaging > 0 AND rendimiento_packaging <= 1);

COMMENT ON COLUMN cerveceriaerp.receta_formatos.rendimiento_packaging IS
  'Fracción del volumen que sobrevive la línea de envasado en este formato. 0,98 = se pierde 2 %.';

-- ---------------------------------------------------------------------------
-- 4. Privilegios: los mismos que `recetas`, para que PostgREST las exponga
-- ---------------------------------------------------------------------------
DO $acl$
DECLARE r record; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['costeo_parametros','receta_costos_operacion'] LOOP
    FOR r IN
      SELECT DISTINCT
             CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                  ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
             a.privilege_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace,
             aclexplode(c.relacl) a
       WHERE n.nspname = 'cerveceriaerp' AND c.relname = 'recetas'
    LOOP
      EXECUTE format('GRANT %s ON cerveceriaerp.%I TO %s', r.privilege_type, t, r.grantee);
    END LOOP;
  END LOOP;
END
$acl$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='cerveceriaerp'
      AND table_name IN ('costeo_parametros','receta_costos_operacion'))  AS tablas_nuevas,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='cerveceriaerp' AND table_name='receta_formatos'
      AND column_name IN ('costo_envase','costo_tapa','costo_etiqueta','costo_pack',
                          'velocidad_unid_hora','operarios','rendimiento_packaging')) AS columnas_envasado;
-- Esperado: 2 | 7
