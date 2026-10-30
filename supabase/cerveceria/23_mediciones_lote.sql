-- =============================================================================
-- 23. Mediciones de fermentación: densidad, temperatura y pH
-- =============================================================================
--
-- POR QUE
-- Las etapas del lote guardaban fecha y nota, nada más. Lo que el cervecero
-- mide todos los días —densidad, temperatura, pH— vivía en una planilla
-- aparte, y con eso se pierden dos cosas: el alcohol del lote (que sale de la
-- densidad inicial y la final) y la respuesta a "¿por qué esta cocción salió
-- distinta?" tres meses después.
--
-- La tabla es del LOTE, no de la etapa: una fermentación se mide varias veces
-- por etapa, y a veces entre etapas.
--
-- La app calcula sola, de la primera y la última densidad:
--   ABV ≈ (OG − FG) × 131.25        atenuación = (OG − FG) / (OG − 1)
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cerveceriaerp.produccion_mediciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  lote_id        uuid NOT NULL REFERENCES cerveceriaerp.produccion_lotes(id) ON DELETE CASCADE,
  fecha          timestamptz NOT NULL DEFAULT now(),
  -- Etapa del lote cuando se midió. Se guarda copiada y no por FK: la etapa del
  -- lote avanza, y la medición tiene que seguir diciendo en cuál se tomó.
  etapa          text,
  densidad       numeric CHECK (densidad IS NULL OR (densidad >= 0.98 AND densidad <= 1.2)),
  temperatura    numeric CHECK (temperatura IS NULL OR (temperatura >= -5 AND temperatura <= 110)),
  ph             numeric CHECK (ph IS NULL OR (ph >= 2 AND ph <= 10)),
  nota           text,
  usuario_id     uuid,
  usuario_nombre text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Una medición sin ningún valor no es una medición.
  CONSTRAINT mediciones_algo_medido CHECK (
    densidad IS NOT NULL OR temperatura IS NOT NULL OR ph IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS produccion_mediciones_lote_idx
  ON cerveceriaerp.produccion_mediciones (empresa_id, lote_id, fecha);

COMMENT ON TABLE cerveceriaerp.produccion_mediciones IS
  'Mediciones de fermentacion de un lote: densidad (SG), temperatura (C) y pH. '
  'La densidad inicial y la final dan el alcohol estimado del lote.';

-- RLS y permisos: los mismos que las demás tablas de producción, copiados de
-- `produccion_lote_etapas` para no inventar una política distinta.
DO $perm$
DECLARE
  r record;
BEGIN
  EXECUTE 'ALTER TABLE cerveceriaerp.produccion_mediciones ENABLE ROW LEVEL SECURITY';

  FOR r IN
    SELECT polname, pg_get_expr(polqual, polrelid) AS usando,
           pg_get_expr(polwithcheck, polrelid) AS concheck, polcmd
      FROM pg_policy
     WHERE polrelid = 'cerveceriaerp.produccion_lote_etapas'::regclass
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = 'cerveceriaerp.produccion_mediciones'::regclass
         AND polname = r.polname
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON cerveceriaerp.produccion_mediciones FOR %s %s %s',
        r.polname,
        CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                      WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        CASE WHEN r.usando IS NULL THEN '' ELSE 'USING (' || r.usando || ')' END,
        CASE WHEN r.concheck IS NULL THEN '' ELSE 'WITH CHECK (' || r.concheck || ')' END
      );
      RAISE NOTICE 'Policy % copiada.', r.polname;
    END IF;
  END LOOP;

  FOR r IN
    SELECT DISTINCT grantee, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'cerveceriaerp' AND table_name = 'produccion_lote_etapas'
  LOOP
    EXECUTE format('GRANT %s ON cerveceriaerp.produccion_mediciones TO %I',
                   r.privilege_type, r.grantee);
  END LOOP;
END
$perm$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT count(*) AS tabla_creada
  FROM information_schema.tables
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'produccion_mediciones';
-- Esperado: 1

SELECT count(*) AS politicas
  FROM pg_policy WHERE polrelid = 'cerveceriaerp.produccion_mediciones'::regclass;
-- Esperado: las mismas que produccion_lote_etapas (normalmente 4).
