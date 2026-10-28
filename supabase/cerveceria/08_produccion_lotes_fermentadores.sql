-- =============================================================================
-- 08 — Producción por lotes y fermentadores
-- =============================================================================
-- Corre DESPUÉS de `07_receta_coven_blonde_ale.sql`.
--
-- POR QUÉ, Y CÓMO SE INTEGRA CON LO QUE YA HAY
--
-- El ERP ya sabe "fabricar": descuenta los insumos de la receta, da de alta el
-- producto y lo costea, todo en un instante. Una cervecería no funciona así:
-- el lote consume la malta el día 0, ocupa un fermentador una o dos semanas,
-- pasa por etapas y recién al final se envasa.
--
-- Este módulo NO reemplaza la fabricación: la envuelve.
--
--   COCIMIENTO  → usa la fabricación que ya existe. Consume los insumos y da
--                 de alta el producto A GRANEL (los 500 L), que es el producto
--                 en proceso. Queda registrado en `producciones`, con sus
--                 movimientos de inventario como siempre.
--   FERMENTACIÓN… → el lote avanza de etapa sin tocar stock.
--   ENVASADO    → descuenta litros del granel y da de alta los formatos
--                 (barriles, botellas). Acá aparece la merma real.
--
-- Así el stock y el costeo siguen saliendo de un solo lugar, y el lote agrega
-- encima la línea de tiempo, el fermentador y la trazabilidad.
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fermentadores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.fermentadores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES cerveceriaerp.empresas(id)   ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES cerveceriaerp.sucursales(id) ON DELETE RESTRICT,
  codigo      text NOT NULL,
  nombre      text NOT NULL,
  capacidad_litros numeric NOT NULL CHECK (capacidad_litros > 0),
  activo      boolean NOT NULL DEFAULT true,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fermentadores_codigo_uq UNIQUE (empresa_id, sucursal_id, codigo)
);

COMMENT ON TABLE cerveceriaerp.fermentadores IS
  'Fermentadores de la planta. La ocupación NO se guarda acá: se deriva del lote activo, para que no puedan desincronizarse.';

-- ---------------------------------------------------------------------------
-- 2. Lotes de producción
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.produccion_lotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES cerveceriaerp.empresas(id)   ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES cerveceriaerp.sucursales(id) ON DELETE RESTRICT,
  codigo      text NOT NULL,
  receta_id   uuid REFERENCES cerveceriaerp.recetas(id)    ON DELETE SET NULL,
  -- Producto EN PROCESO: la cerveza a granel, en litros.
  producto_granel_id uuid NOT NULL REFERENCES cerveceriaerp.productos(id) ON DELETE RESTRICT,
  fermentador_id     uuid REFERENCES cerveceriaerp.fermentadores(id) ON DELETE RESTRICT,

  estado text NOT NULL DEFAULT 'planificado',

  volumen_planificado numeric CHECK (volumen_planificado IS NULL OR volumen_planificado > 0),
  /** Litros realmente obtenidos al knockout. Se carga al iniciar el cocimiento. */
  volumen_obtenido    numeric CHECK (volumen_obtenido IS NULL OR volumen_obtenido >= 0),
  /** Suma de litros envasados. Lo mantiene el trigger de `produccion_lote_envasado`. */
  volumen_envasado    numeric NOT NULL DEFAULT 0,

  fecha_inicio        timestamptz,
  fecha_fin_estimada  date,
  fecha_fin           timestamptz,

  responsable_usuario_id uuid REFERENCES cerveceriaerp.usuarios(id) ON DELETE SET NULL,
  responsable_nombre     text,

  /** Fila de `producciones` del cocimiento: ahí viven el consumo y su costo. */
  produccion_id uuid,

  observaciones text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT produccion_lotes_codigo_uq UNIQUE (empresa_id, codigo),
  CONSTRAINT produccion_lotes_estado_check CHECK (estado = ANY (ARRAY[
    'planificado', 'cocimiento', 'fermentacion', 'maduracion',
    'carbonatacion', 'envasado', 'cerrado', 'cancelado'
  ]))
);

CREATE INDEX IF NOT EXISTS idx_lotes_sucursal_estado
  ON cerveceriaerp.produccion_lotes (empresa_id, sucursal_id, estado);
CREATE INDEX IF NOT EXISTS idx_lotes_fermentador
  ON cerveceriaerp.produccion_lotes (fermentador_id);

-- UN LOTE ACTIVO POR FERMENTADOR, garantizado por la base y no por la app:
-- dos personas registrando a la vez no pueden meter dos lotes en el mismo tanque.
CREATE UNIQUE INDEX IF NOT EXISTS produccion_lotes_fermentador_activo_uq
  ON cerveceriaerp.produccion_lotes (fermentador_id)
  WHERE fermentador_id IS NOT NULL
    AND estado = ANY (ARRAY['cocimiento','fermentacion','maduracion','carbonatacion','envasado']);

COMMENT ON TABLE cerveceriaerp.produccion_lotes IS
  'Lote de cerveza: fermentador, etapas, fechas, responsable y volúmenes. El consumo de insumos vive en `producciones`.';

-- ---------------------------------------------------------------------------
-- 3. Historial de etapas
-- ---------------------------------------------------------------------------
-- Tabla aparte y no una columna: el documento de producción pide saber CUÁNDO
-- pasó cada etapa y quién la registró, no sólo en cuál está ahora.
CREATE TABLE IF NOT EXISTS cerveceriaerp.produccion_lote_etapas (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id   uuid NOT NULL REFERENCES cerveceriaerp.produccion_lotes(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  etapa     text NOT NULL,
  fecha     timestamptz NOT NULL DEFAULT now(),
  usuario_id     uuid,
  usuario_nombre text,
  nota      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lote_etapas_lote
  ON cerveceriaerp.produccion_lote_etapas (lote_id, fecha);

-- ---------------------------------------------------------------------------
-- 4. Envasado del lote
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.produccion_lote_envasado (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id     uuid NOT NULL REFERENCES cerveceriaerp.produccion_lotes(id) ON DELETE CASCADE,
  empresa_id  uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES cerveceriaerp.productos(id) ON DELETE RESTRICT,
  producto_nombre text NOT NULL,
  cantidad    numeric NOT NULL CHECK (cantidad > 0),
  /** Litros de granel que consumió este envasado: cantidad × capacidad del formato. */
  litros      numeric NOT NULL CHECK (litros > 0),
  costo_unitario numeric NOT NULL DEFAULT 0,
  fecha       timestamptz NOT NULL DEFAULT now(),
  usuario_id     uuid,
  usuario_nombre text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lote_envasado_lote
  ON cerveceriaerp.produccion_lote_envasado (lote_id);

-- `volumen_envasado` se mantiene solo: si lo calculara la app, un envasado
-- registrado por otra vía lo dejaría desactualizado y la merma saldría mal.
CREATE OR REPLACE FUNCTION cerveceriaerp.fn_lote_sync_envasado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'cerveceriaerp', 'public'
AS $$
DECLARE
  v_lote uuid := COALESCE(NEW.lote_id, OLD.lote_id);
BEGIN
  UPDATE cerveceriaerp.produccion_lotes
     SET volumen_envasado = COALESCE(
           (SELECT SUM(e.litros) FROM cerveceriaerp.produccion_lote_envasado e
             WHERE e.lote_id = v_lote), 0),
         updated_at = now()
   WHERE id = v_lote;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lote_sync_envasado ON cerveceriaerp.produccion_lote_envasado;
CREATE TRIGGER trg_lote_sync_envasado
  AFTER INSERT OR UPDATE OR DELETE ON cerveceriaerp.produccion_lote_envasado
  FOR EACH ROW EXECUTE FUNCTION cerveceriaerp.fn_lote_sync_envasado();

-- ---------------------------------------------------------------------------
-- 5. Guardas que la base puede hacer cumplir
-- ---------------------------------------------------------------------------
-- La capacidad del fermentador cruza dos tablas, así que no entra en un CHECK.
-- Va como trigger y no como validación de la app: un lote que no entra en el
-- tanque es un error de datos, no una decisión de pantalla.
CREATE OR REPLACE FUNCTION cerveceriaerp.fn_lote_valida_fermentador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'cerveceriaerp', 'public'
AS $$
DECLARE
  v_cap numeric;
  v_suc uuid;
  v_vol numeric := COALESCE(NEW.volumen_obtenido, NEW.volumen_planificado);
BEGIN
  IF NEW.fermentador_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT capacidad_litros, sucursal_id INTO v_cap, v_suc
    FROM cerveceriaerp.fermentadores WHERE id = NEW.fermentador_id;

  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'El fermentador indicado no existe.';
  END IF;
  IF v_suc <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'El fermentador es de otra sucursal.';
  END IF;
  IF v_vol IS NOT NULL AND v_vol > v_cap THEN
    RAISE EXCEPTION 'El lote (% L) no entra en el fermentador (capacidad % L).', v_vol, v_cap;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lote_valida_fermentador ON cerveceriaerp.produccion_lotes;
CREATE TRIGGER trg_lote_valida_fermentador
  BEFORE INSERT OR UPDATE ON cerveceriaerp.produccion_lotes
  FOR EACH ROW EXECUTE FUNCTION cerveceriaerp.fn_lote_valida_fermentador();

-- ---------------------------------------------------------------------------
-- 6. Trazabilidad: el movimiento de inventario sabe de qué lote salió
-- ---------------------------------------------------------------------------
ALTER TABLE cerveceriaerp.movimientos_inventario
  ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES cerveceriaerp.produccion_lotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_lote
  ON cerveceriaerp.movimientos_inventario (lote_id);

COMMENT ON COLUMN cerveceriaerp.movimientos_inventario.lote_id IS
  'Lote que originó el movimiento. Permite seguir un lote desde el cocimiento hasta el despacho.';

-- ---------------------------------------------------------------------------
-- 7. Privilegios, copiados de `recetas` para que PostgREST las exponga igual
-- ---------------------------------------------------------------------------
DO $acl$
DECLARE r record; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fermentadores','produccion_lotes','produccion_lote_etapas','produccion_lote_envasado']
  LOOP
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

-- ---------------------------------------------------------------------------
-- 8. Módulo "Producción" en el menú
-- ---------------------------------------------------------------------------
-- El seed del paso 02 ya lo incluye para instalaciones nuevas; esto es para la
-- que ya corrió el 02 antes de que este módulo existiera.
DO $mod$
DECLARE
  v_empresa CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_modulo  uuid;
BEGIN
  SELECT id INTO v_modulo FROM cerveceriaerp.modulos WHERE slug = 'produccion';
  IF v_modulo IS NULL THEN
    INSERT INTO cerveceriaerp.modulos (nombre, slug)
    VALUES ('Producción', 'produccion')
    RETURNING id INTO v_modulo;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.empresa_modulos
                  WHERE empresa_id = v_empresa AND modulo_id = v_modulo) THEN
    INSERT INTO cerveceriaerp.empresa_modulos (empresa_id, modulo_id, activo)
    VALUES (v_empresa, v_modulo, true);
  END IF;
END
$mod$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verificación
-- =============================================================================
SELECT table_name, (SELECT count(*) FROM information_schema.columns c
                     WHERE c.table_schema = 'cerveceriaerp' AND c.table_name = t.table_name) AS columnas
  FROM (VALUES ('fermentadores'), ('produccion_lotes'),
               ('produccion_lote_etapas'), ('produccion_lote_envasado')) AS t(table_name);

SELECT 'movimientos_inventario.lote_id' AS objeto, count(*) AS existe
  FROM information_schema.columns
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'movimientos_inventario' AND column_name = 'lote_id';
