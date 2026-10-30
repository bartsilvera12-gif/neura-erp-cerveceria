-- =============================================================================
-- 21. Unificar MP-CARADEX dentro de MP-CARACLAIR
-- =============================================================================
--
-- ⚠️  CONFIRMAR ANTES DE CORRER
-- Este script da por hecho que son el MISMO insumo con dos nombres. La
-- evidencia es fuerte: en la planilla de cocción el lote 1 de Blonde Ale lleva
-- "CARACLAIR 4,17 kg a 22.300", y el script 07 cargó esa misma línea como
-- "Malta Caradextrina UMA 4,17 kg". Misma receta, misma cantidad exacta, otro
-- nombre. (El lote 2 escribe "CLARA CLAIR" al mismo precio por kilo: es la
-- tercera forma de escribir lo mismo.)
--
-- Si resultara que son dos maltas distintas que de verdad usan, esto mezcla el
-- historial de las dos y no se deshace solo. Preguntar primero.
--
-- QUE HACE
--   1. Todo lo que apuntaba a MP-CARADEX pasa a apuntar a MP-CARACLAIR:
--      recetas, compras, movimientos de inventario y cualquier otra tabla que
--      referencie el producto. No se buscan las tablas a mano: se recorren las
--      claves foráneas que apuntan a `productos`, así no queda ninguna afuera.
--   2. El stock de los dos se suma en MP-CARACLAIR.
--   3. MP-CARADEX NO SE BORRA: queda desactivado y renombrado. Borrarlo se
--      llevaría puesto el rastro de por qué las cantidades viejas son las que
--      son.
--
-- Sobrevive CARACLAIR porque es el nombre que figura en el documento del
-- cliente, que es contra lo que después se compara una factura del proveedor.
--
-- Idempotente: correrlo dos veces no cambia nada la segunda.
-- Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $unif$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';  -- Cervecería
  v_queda_sku   CONSTANT text := 'MP-CARACLAIR';
  v_absorb_sku  CONSTANT text := 'MP-CARADEX';

  v_queda       uuid;
  v_absorb      uuid;
  v_stock_queda numeric;
  v_stock_abs   numeric;
  v_costo_queda numeric;
  v_costo_abs   numeric;
  r         record;
  v_filas   integer;
  v_total   integer := 0;
BEGIN
  SELECT id, stock_actual, costo_promedio INTO v_queda, v_stock_queda, v_costo_queda
    FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = v_queda_sku;

  SELECT id, stock_actual, costo_promedio INTO v_absorb, v_stock_abs, v_costo_abs
    FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = v_absorb_sku;

  IF v_queda IS NULL THEN
    RAISE EXCEPTION 'No existe % en Cerveceria: nada que unificar.', v_queda_sku;
  END IF;
  IF v_absorb IS NULL THEN
    RAISE NOTICE 'No existe %: ya estaba unificado. Nada que hacer.', v_absorb_sku;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. Recetas que ya tienen los DOS insumos
  -- ---------------------------------------------------------------------------
  -- Hay un único por (receta_id, insumo_producto_id): si una receta lleva los
  -- dos, repuntar el segundo choca. Se suman las cantidades en la fila que
  -- queda y se borra la otra.
  FOR r IN
    SELECT a.id AS id_absorb, q.id AS id_queda, a.cantidad AS cant_absorb
      FROM cerveceriaerp.receta_items a
      JOIN cerveceriaerp.receta_items q
        ON q.receta_id = a.receta_id AND q.insumo_producto_id = v_queda
     WHERE a.insumo_producto_id = v_absorb
  LOOP
    UPDATE cerveceriaerp.receta_items
       SET cantidad = cantidad + r.cant_absorb
     WHERE id = r.id_queda;
    DELETE FROM cerveceriaerp.receta_items WHERE id = r.id_absorb;
    RAISE NOTICE 'Receta con los dos insumos: cantidades sumadas en una sola linea.';
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. Repuntar TODO lo que referencie al producto
  -- ---------------------------------------------------------------------------
  -- Se recorren las claves foráneas que apuntan a `productos` en vez de
  -- escribir la lista de tablas a mano: si mañana aparece otra tabla con
  -- producto_id, este script la cubre igual.
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabla,
           a.attname                  AS columna
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND n.nspname = 'cerveceriaerp'
       AND c.confrelid = 'cerveceriaerp.productos'::regclass
       AND c.conrelid <> 'cerveceriaerp.productos'::regclass
     ORDER BY 1, 2
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.tabla, r.columna, r.columna)
      USING v_queda, v_absorb;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas > 0 THEN
      v_total := v_total + v_filas;
      RAISE NOTICE '% .% -> % filas repuntadas', r.tabla, r.columna, v_filas;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. El stock se suma; el costo queda el del que sobrevive
  -- ---------------------------------------------------------------------------
  -- El costo de CARACLAIR sale de sus propias compras. Sólo se toma el del
  -- absorbido si el que queda no tiene ninguno cargado.
  UPDATE cerveceriaerp.productos
     SET stock_actual = stock_actual + coalesce(v_stock_abs, 0),
         costo_promedio = CASE
           WHEN coalesce(v_costo_queda, 0) > 0 THEN costo_promedio
           ELSE coalesce(v_costo_abs, 0)
         END,
         updated_at = now()
   WHERE id = v_queda;

  -- ---------------------------------------------------------------------------
  -- 4. El absorbido queda desactivado, no borrado
  -- ---------------------------------------------------------------------------
  UPDATE cerveceriaerp.productos
     SET activo = false,
         controla_stock = false,
         stock_actual = 0,
         nombre = CASE
           WHEN nombre LIKE '%(unificado%' THEN nombre
           ELSE nombre || ' (unificado en ' || v_queda_sku || ')'
         END,
         updated_at = now()
   WHERE id = v_absorb;

  RAISE NOTICE 'Unificacion lista: % filas repuntadas. % queda activo, % desactivado.',
    v_total, v_queda_sku, v_absorb_sku;
END
$unif$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT sku, nombre, activo, stock_actual, costo_promedio
  FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND sku IN ('MP-CARACLAIR', 'MP-CARADEX')
 ORDER BY sku;
-- Esperado: CARACLAIR activo con el stock sumado; CARADEX inactivo, en 0 y con
-- "(unificado en MP-CARACLAIR)" en el nombre.

-- Nada debería seguir apuntando al absorbido:
SELECT count(*) AS recetas_con_el_viejo
  FROM cerveceriaerp.receta_items ri
  JOIN cerveceriaerp.productos p ON p.id = ri.insumo_producto_id
 WHERE p.sku = 'MP-CARADEX';
-- Esperado: 0.

-- Y el costeo de la Blonde Ale 500 L tiene que cerrar contra la planilla:
SELECT r.nombre AS receta, p.sku, p.nombre AS insumo, ri.cantidad, ri.unidad_medida
  FROM cerveceriaerp.recetas r
  JOIN cerveceriaerp.receta_items ri ON ri.receta_id = r.id
  JOIN cerveceriaerp.productos p ON p.id = ri.insumo_producto_id
 WHERE r.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND r.nombre ILIKE '%blonde%'
 ORDER BY r.nombre, ri.orden;
-- El renglón de Caraclair tiene que aparecer UNA sola vez.
