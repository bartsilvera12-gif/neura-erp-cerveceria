-- =============================================================================
-- 06 — Precio en Recetas: merma de proceso, formatos de venta y precio sugerido
-- =============================================================================
-- Corre DESPUÉS de `04_sucursales_cerveceria_bar.sql`.
--
-- QUÉ RESUELVE
--
-- El costeo de recetas ya calculaba `costo_total` (insumos × merma × costo
-- promedio) y lo dividía por el rendimiento. Para una cervecería eso no alcanza:
--
--  1. MERMA DE PROCESO. De 500 L teóricos se envasan menos (trub, whirlpool,
--     purga de cono, líneas). El costo real por litro vendible es el costo
--     total sobre lo que SE ENVASA, no sobre lo que se calculó en papel.
--
--  2. FORMATOS. Un mismo lote se reparte entre barriles y botellas, y cada
--     formato es un producto vendible con su propio precio. El costo de cada
--     uno sale del costo por litro envasable × su capacidad.
--
--  3. PRECIO SUGERIDO. Antes el margen se medía contra un precio cargado a
--     mano. Ahora, con un margen objetivo por producto, el ERP dice cuánto
--     cobrar para llegar a ese margen.
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Merma de proceso por receta
-- ---------------------------------------------------------------------------
-- Fracción (0,15 = 15 %), igual que `receta_items.merma_pct`, para no mezclar
-- dos convenciones en la misma pantalla. < 1 porque una merma del 100 % no
-- deja nada que vender y haría dividir por cero.
ALTER TABLE cerveceriaerp.recetas
  ADD COLUMN IF NOT EXISTS merma_proceso_pct numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cerveceriaerp.recetas'::regclass
       AND conname = 'recetas_merma_proceso_pct_check'
  ) THEN
    ALTER TABLE cerveceriaerp.recetas
      ADD CONSTRAINT recetas_merma_proceso_pct_check
      CHECK (merma_proceso_pct >= 0 AND merma_proceso_pct < 1);
  END IF;
END $$;

COMMENT ON COLUMN cerveceriaerp.recetas.merma_proceso_pct IS
  'Fracción del rendimiento que se pierde en el proceso (0,06 = 6 %). El costo por unidad vendible se calcula sobre el rendimiento neto.';

-- ---------------------------------------------------------------------------
-- 2. Margen objetivo por producto
-- ---------------------------------------------------------------------------
-- Margen SOBRE EL PRECIO, no markup sobre el costo: es la misma convención que
-- ya usa `margen_pct` en el costeo, así los dos números de la pantalla se leen
-- igual. precio = costo / (1 - margen).
ALTER TABLE cerveceriaerp.productos
  ADD COLUMN IF NOT EXISTS margen_objetivo_pct numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'cerveceriaerp.productos'::regclass
       AND conname = 'productos_margen_objetivo_pct_check'
  ) THEN
    ALTER TABLE cerveceriaerp.productos
      ADD CONSTRAINT productos_margen_objetivo_pct_check
      CHECK (margen_objetivo_pct IS NULL
             OR (margen_objetivo_pct >= 0 AND margen_objetivo_pct < 1));
  END IF;
END $$;

COMMENT ON COLUMN cerveceriaerp.productos.margen_objetivo_pct IS
  'Margen objetivo sobre el precio (0,35 = 35 %). NULL = sin objetivo; el ERP no sugiere precio.';

-- ---------------------------------------------------------------------------
-- 3. Formatos de venta de una receta
-- ---------------------------------------------------------------------------
-- Un lote se reparte entre varios productos vendibles (barril 30 L, botella
-- 500 ml). Cada fila dice qué producto es y cuánto rendimiento consume.
--
-- `sucursal_id` acompaña a la receta: el catálogo está separado por sucursal y
-- un formato no puede apuntar a un producto de la otra.
CREATE TABLE IF NOT EXISTS cerveceriaerp.receta_formatos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id   uuid NOT NULL REFERENCES cerveceriaerp.recetas(id)   ON DELETE CASCADE,
  empresa_id  uuid NOT NULL REFERENCES cerveceriaerp.empresas(id)  ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES cerveceriaerp.sucursales(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES cerveceriaerp.productos(id) ON DELETE RESTRICT,
  capacidad        numeric NOT NULL CHECK (capacidad > 0),
  capacidad_unidad text    NOT NULL,
  orden       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receta_formatos_producto_uq UNIQUE (receta_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_receta_formatos_receta ON cerveceriaerp.receta_formatos (receta_id);

COMMENT ON TABLE cerveceriaerp.receta_formatos IS
  'Formatos de venta de una receta (barril 30 L, botella 500 ml). Cada uno es un producto vendible con su propio precio.';

-- Privilegios copiados de `recetas`, para que PostgREST la exponga igual.
DO $acl$
DECLARE r record;
BEGIN
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
    EXECUTE format('GRANT %s ON cerveceriaerp.receta_formatos TO %s', r.privilege_type, r.grantee);
  END LOOP;
END
$acl$;

-- ---------------------------------------------------------------------------
-- 3b. Unidades: factor a la unidad base de su familia, y compatibilidad
-- ---------------------------------------------------------------------------
-- El costeo tenía esta tabla de conversión repetida en dos CASE enormes. Con
-- los formatos haría falta repetirla dos veces más, así que se extrae: una
-- unidad nueva se agrega acá y vale para todo.
--
-- Devuelve NULL para una unidad desconocida; el costeo lo trata como
-- incompatible en vez de inventar una conversión.
CREATE OR REPLACE FUNCTION cerveceriaerp.fn_unidad_factor(p_unidad text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(trim(COALESCE(p_unidad, '')))
    WHEN 'G'   THEN 1     WHEN 'GR'  THEN 1    WHEN 'GRS' THEN 1
    WHEN 'KG'  THEN 1000
    WHEN 'ML'  THEN 1     WHEN 'L'   THEN 1000 WHEN 'LT'  THEN 1000
    WHEN 'LTS' THEN 1000
    WHEN 'UNIDAD' THEN 1  WHEN 'UNID' THEN 1   WHEN 'U'   THEN 1
    ELSE NULL
  END::numeric;
$$;

/** Dos unidades son compatibles si pertenecen a la misma familia (masa, volumen, conteo). */
CREATE OR REPLACE FUNCTION cerveceriaerp.fn_unidad_compatible(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH f AS (
    SELECT CASE WHEN upper(trim(COALESCE(p_a, ''))) IN ('G','GR','GRS','KG')      THEN 'masa'
                WHEN upper(trim(COALESCE(p_a, ''))) IN ('ML','L','LT','LTS')      THEN 'volumen'
                WHEN upper(trim(COALESCE(p_a, ''))) IN ('UNIDAD','UNID','U')      THEN 'conteo'
           END AS fa,
           CASE WHEN upper(trim(COALESCE(p_b, ''))) IN ('G','GR','GRS','KG')      THEN 'masa'
                WHEN upper(trim(COALESCE(p_b, ''))) IN ('ML','L','LT','LTS')      THEN 'volumen'
                WHEN upper(trim(COALESCE(p_b, ''))) IN ('UNIDAD','UNID','U')      THEN 'conteo'
           END AS fb
  )
  SELECT COALESCE(fa IS NOT NULL AND fa = fb, false) FROM f;
$$;

GRANT EXECUTE ON FUNCTION cerveceriaerp.fn_unidad_factor(text)        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cerveceriaerp.fn_unidad_compatible(text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Costeo: mismas claves de antes, más las nuevas
-- ---------------------------------------------------------------------------
-- Compatible hacia atrás a propósito: la pantalla actual sigue leyendo
-- `costo_total`, `costo_unitario`, `margen_pct` y `unidades_posibles` sin
-- cambios, y las claves nuevas se suman.
CREATE OR REPLACE FUNCTION cerveceriaerp.fn_receta_costeo(p_receta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'cerveceriaerp', 'public'
AS $function$
DECLARE
  v_costo_total        numeric := 0;
  v_precio_venta       numeric := 0;
  v_rendimiento        numeric := 1;
  v_merma_proceso      numeric := 0;
  v_rend_envasable     numeric;
  v_costo_envasable    numeric;
  v_unidades_posibles  numeric;
  v_items              jsonb;
  v_formatos           jsonb;
  v_producto_id        uuid;
  v_rend_unidad        text;
  v_f_rend             numeric;
BEGIN
  SELECT r.producto_id,
         COALESCE(r.rendimiento_cantidad, 1),
         COALESCE(p.precio_venta, 0),
         COALESCE(r.merma_proceso_pct, 0),
         upper(trim(COALESCE(r.rendimiento_unidad, '')))
    INTO v_producto_id, v_rendimiento, v_precio_venta, v_merma_proceso, v_rend_unidad
  FROM cerveceriaerp.recetas r
  JOIN cerveceriaerp.productos p ON p.id = r.producto_id
  WHERE r.id = p_receta_id;

  IF v_producto_id IS NULL THEN
    RETURN jsonb_build_object('error', 'receta_no_encontrada');
  END IF;

  WITH base AS (
    SELECT
      ri.id, ri.insumo_producto_id, pi.nombre AS insumo_nombre, ri.orden,
      ri.cantidad, ri.unidad_medida, COALESCE(ri.merma_pct, 0) AS merma_pct,
      pi.costo_promedio, pi.stock_actual,
      upper(trim(COALESCE(NULLIF(ri.unidad_medida, ''), pi.unidad_medida))) AS u_item,
      upper(trim(pi.unidad_medida)) AS u_ins
    FROM cerveceriaerp.receta_items ri
    JOIN cerveceriaerp.productos pi ON pi.id = ri.insumo_producto_id
    WHERE ri.receta_id = p_receta_id
  ),
  fam AS (
    SELECT b.*,
      cerveceriaerp.fn_unidad_factor(u_item) AS f_item,
      cerveceriaerp.fn_unidad_factor(u_ins)  AS f_ins,
      cerveceriaerp.fn_unidad_compatible(u_item, u_ins) AS compat
    FROM base b
  ),
  item_calc AS (
    SELECT *,
      (CASE WHEN compat AND f_ins > 0 THEN cantidad * f_item / f_ins ELSE NULL END) AS cant_insumo,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) ELSE NULL END) AS cantidad_efectiva,
      (CASE WHEN compat AND f_ins > 0 THEN (cantidad * f_item / f_ins) * (1 + merma_pct) * COALESCE(costo_promedio, 0) ELSE 0 END) AS subcosto,
      (CASE WHEN compat AND f_ins > 0 AND (cantidad * f_item / f_ins) * (1 + merma_pct) > 0
            THEN FLOOR(COALESCE(stock_actual, 0) / ((cantidad * f_item / f_ins) * (1 + merma_pct)))
            ELSE NULL END) AS unidades_aporte,
      (NOT compat) AS unidad_incompatible
    FROM fam
  )
  SELECT COALESCE(SUM(subcosto), 0),
         MIN(unidades_aporte),
         COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', id,
           'insumo_producto_id', insumo_producto_id,
           'insumo_nombre', insumo_nombre,
           'cantidad', cantidad,
           'unidad_medida', unidad_medida,
           'merma_pct', merma_pct,
           'costo_promedio', costo_promedio,
           'stock_actual', stock_actual,
           'subcosto', subcosto,
           'unidades_aporte', unidades_aporte,
           'unidad_incompatible', unidad_incompatible
         ) ORDER BY orden, insumo_nombre), '[]'::jsonb)
    INTO v_costo_total, v_unidades_posibles, v_items
  FROM item_calc;

  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.receta_items WHERE receta_id = p_receta_id) THEN
    v_unidades_posibles := NULL;
  END IF;

  -- Rendimiento NETO: lo que realmente se envasa.
  v_rend_envasable  := v_rendimiento * (1 - v_merma_proceso);
  v_costo_envasable := CASE WHEN v_rend_envasable > 0 THEN v_costo_total / v_rend_envasable END;
  v_f_rend          := cerveceriaerp.fn_unidad_factor(v_rend_unidad);

  -- Formatos: costo por envase, precio actual y precio sugerido.
  SELECT COALESCE(jsonb_agg(f ORDER BY f->>'orden', f->>'producto_nombre'), '[]'::jsonb)
    INTO v_formatos
  FROM (
    SELECT jsonb_build_object(
      'formato_id',        rf.id,
      'producto_id',       rf.producto_id,
      'producto_nombre',   pf.nombre,
      'capacidad',         rf.capacidad,
      'capacidad_unidad',  rf.capacidad_unidad,
      'orden',             rf.orden,
      'unidad_incompatible', NOT cerveceriaerp.fn_unidad_compatible(
                               upper(trim(rf.capacidad_unidad)), v_rend_unidad),
      'capacidad_en_rendimiento', cap.en_rend,
      'unidades_por_lote', CASE WHEN cap.en_rend > 0 THEN FLOOR(v_rend_envasable / cap.en_rend) END,
      'costo_unitario',    CASE WHEN cap.en_rend > 0 THEN v_costo_envasable * cap.en_rend END,
      'precio_venta',      COALESCE(pf.precio_venta, 0),
      'margen_objetivo_pct', pf.margen_objetivo_pct,
      'precio_sugerido',   CASE
                             WHEN cap.en_rend > 0
                              AND pf.margen_objetivo_pct IS NOT NULL
                              AND pf.margen_objetivo_pct < 1
                             THEN (v_costo_envasable * cap.en_rend) / (1 - pf.margen_objetivo_pct)
                           END,
      'margen_pct',        CASE
                             WHEN COALESCE(pf.precio_venta, 0) > 0 AND cap.en_rend > 0
                             THEN ROUND((((pf.precio_venta - v_costo_envasable * cap.en_rend)
                                          / pf.precio_venta) * 100)::numeric, 2)
                           END
    ) AS f
    FROM cerveceriaerp.receta_formatos rf
    JOIN cerveceriaerp.productos pf ON pf.id = rf.producto_id
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN cerveceriaerp.fn_unidad_compatible(upper(trim(rf.capacidad_unidad)), v_rend_unidad)
                AND v_f_rend > 0
               THEN rf.capacidad * cerveceriaerp.fn_unidad_factor(upper(trim(rf.capacidad_unidad))) / v_f_rend
             END AS en_rend
    ) cap
    WHERE rf.receta_id = p_receta_id
  ) s;

  RETURN jsonb_build_object(
    'receta_id', p_receta_id,
    'producto_id', v_producto_id,
    'rendimiento_cantidad', v_rendimiento,
    'costo_total', v_costo_total,
    'costo_unitario', CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE NULL END,
    'precio_venta', v_precio_venta,
    'margen_abs', v_precio_venta - (CASE WHEN v_rendimiento > 0 THEN v_costo_total / v_rendimiento ELSE 0 END),
    'margen_pct', CASE
      WHEN v_precio_venta > 0 AND v_rendimiento > 0
      THEN ROUND(((v_precio_venta - (v_costo_total / v_rendimiento)) / v_precio_venta * 100)::numeric, 2)
      ELSE NULL
    END,
    'unidades_posibles', v_unidades_posibles,
    'items', v_items,
    -- Claves nuevas
    'merma_proceso_pct', v_merma_proceso,
    'rendimiento_unidad', NULLIF(v_rend_unidad, ''),
    'rendimiento_envasable', v_rend_envasable,
    'costo_unitario_envasable', v_costo_envasable,
    'formatos', v_formatos
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION cerveceriaerp.fn_receta_costeo(uuid) TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verificación
-- =============================================================================
SELECT 'recetas.merma_proceso_pct'      AS objeto, count(*) AS existe
  FROM information_schema.columns
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'recetas' AND column_name = 'merma_proceso_pct'
UNION ALL
SELECT 'productos.margen_objetivo_pct', count(*)
  FROM information_schema.columns
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'productos' AND column_name = 'margen_objetivo_pct'
UNION ALL
SELECT 'tabla receta_formatos', count(*)
  FROM information_schema.tables
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'receta_formatos';
