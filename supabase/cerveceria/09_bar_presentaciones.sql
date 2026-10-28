-- =============================================================================
-- 09 — Presentaciones del bar: chop, botella y litro
-- =============================================================================
-- Corre DESPUÉS de `08_produccion_lotes_fermentadores.sql`.
--
-- ESTO ES CONFIGURACIÓN, NO UNA FUNCIÓN NUEVA.
--
-- El motor de ventas ya sabe convertir presentaciones a stock. Un producto con
-- `modo_receta = 'preparado_al_vender'` y una receta NO descuenta su propio
-- stock: explota la receta y descuenta los insumos, convirtiendo unidades.
-- La fórmula que aplica es:
--
--     consumo = cantidad_vendida × cantidad_item × (1 + merma) / rendimiento
--
-- Así, un "Chop 500 ml" cuya receta es 500 ML de cerveza a granel descuenta
-- 0,5 L del granel por cada chop vendido. Vender 3 chops descuenta 1,5 L.
--
-- EL CIRCUITO COMPLETO:
--   1. Producción envasa o deja la cerveza a granel (litros).
--   2. Reposición transfiere el granel de Cervecería al Bar. El emparejamiento
--      entre sucursales es por SKU, por eso el granel del Bar usa el MISMO SKU
--      que el de Cervecería.
--   3. El bar vende chops y botellas: cada venta descuenta litros del granel.
--
-- ⚠️  LOS PRECIOS van en 0. Se cargan desde Inventario, o con el margen
--     objetivo y el precio sugerido de la receta.
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $bar$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_bar      CONSTANT uuid := 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31';  -- sucursal Bar
  v_sku_granel CONSTANT text := 'CV-BL-GRANEL';  -- el mismo que en Cervecería

  -- Presentaciones que vende el bar. `ml` es lo que consume cada unidad.
  v_presentaciones CONSTANT jsonb := '[
    {"sku":"BAR-CHOP-500",    "nombre":"Chop Coven Blonde 500 ml", "ml":500},
    {"sku":"BAR-CHOP-1000",   "nombre":"Chop Coven Blonde 1 L",    "ml":1000},
    {"sku":"BAR-BOT-500",     "nombre":"Botella Coven Blonde 500 ml", "ml":500}
  ]'::jsonb;

  r            record;
  v_granel     uuid;
  v_producto   uuid;
  v_receta     uuid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Cerveza a granel EN EL BAR
  -- ---------------------------------------------------------------------------
  -- Es el stock del que salen todas las presentaciones. Entra por transferencia
  -- desde Cervecería, no por compra ni producción.
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_bar AND sku = v_sku_granel;

  IF v_granel IS NULL THEN
    INSERT INTO cerveceriaerp.productos
      (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
       precio_venta, stock_actual, activo, controla_stock, es_vendible, es_insumo)
    VALUES
      (v_empresa, v_bar, 'Coven Blonde Ale (granel)', v_sku_granel, 'L', 0,
       0, 0, true, true, false, true)
    RETURNING id INTO v_granel;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Presentaciones vendibles + su receta de conversión
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM jsonb_array_elements(v_presentaciones) AS t(j)
  LOOP
    SELECT id INTO v_producto FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_bar AND sku = (r.j ->> 'sku');

    IF v_producto IS NULL THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock, es_vendible, es_insumo,
         modo_receta)
      VALUES
        (v_empresa, v_bar, r.j ->> 'nombre', r.j ->> 'sku', 'UNIDAD', 0,
         0, 0, true,
         -- No controla stock propio: el stock real es el granel, y la receta
         -- es la que descuenta. Si controlara el suyo habría doble descuento.
         false, true, false,
         'preparado_al_vender')
      RETURNING id INTO v_producto;
    ELSE
      UPDATE cerveceriaerp.productos
         SET modo_receta = 'preparado_al_vender',
             controla_stock = false,
             es_vendible = true
       WHERE id = v_producto;
    END IF;

    -- Receta de conversión: 1 unidad de la presentación = N ml de granel.
    SELECT id INTO v_receta FROM cerveceriaerp.recetas
     WHERE empresa_id = v_empresa AND producto_id = v_producto;

    IF v_receta IS NULL THEN
      INSERT INTO cerveceriaerp.recetas
        (empresa_id, sucursal_id, producto_id, nombre,
         rendimiento_cantidad, rendimiento_unidad, activa)
      VALUES
        (v_empresa, v_bar, v_producto,
         'Servido: ' || (r.j ->> 'nombre'), 1, 'UNIDAD', true)
      RETURNING id INTO v_receta;
    END IF;

    IF EXISTS (SELECT 1 FROM cerveceriaerp.receta_items
                WHERE receta_id = v_receta AND insumo_producto_id = v_granel) THEN
      UPDATE cerveceriaerp.receta_items
         SET cantidad = (r.j ->> 'ml')::numeric, unidad_medida = 'ML'
       WHERE receta_id = v_receta AND insumo_producto_id = v_granel;
    ELSE
      INSERT INTO cerveceriaerp.receta_items
        (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
      VALUES
        (v_receta, v_empresa, v_granel, (r.j ->> 'ml')::numeric, 'ML', 0, 1);
    END IF;
  END LOOP;

  RAISE NOTICE 'Presentaciones del bar listas. Granel: %', v_granel;
  RAISE NOTICE 'Faltan los PRECIOS de cada presentación (van en 0).';
END
$bar$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verificación — cuántos litros de granel consume cada presentación
-- =============================================================================
SELECT p.sku,
       p.nombre,
       p.modo_receta,
       p.controla_stock,
       p.precio_venta,
       ri.cantidad || ' ' || ri.unidad_medida AS consume,
       (ri.cantidad / 1000.0) || ' L de granel por unidad' AS equivalencia
  FROM cerveceriaerp.productos p
  JOIN cerveceriaerp.recetas r      ON r.producto_id = p.id
  JOIN cerveceriaerp.receta_items ri ON ri.receta_id = r.id
  JOIN cerveceriaerp.productos g     ON g.id = ri.insumo_producto_id
 WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND p.sucursal_id = 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31'
   AND g.sku = 'CV-BL-GRANEL'
 ORDER BY p.sku;
