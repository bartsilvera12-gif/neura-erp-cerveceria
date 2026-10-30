-- =============================================================================
-- 18. Puntos críticos de industria: mínimos que disparan el aviso
-- =============================================================================
--
-- QUE HACE
-- Deja los 8 insumos de la planilla "Puntos críticos en industria" cargados en
-- el inventario de Cervecería, cada uno con su STOCK MINIMO. El ERP ya avisa
-- solo: cuando el stock queda en el mínimo o por debajo, el insumo aparece en
-- el Dashboard ("Productos críticos — stock bajo mínimo"), en Inventario con
-- el filtro "stock bajo" y en Reportes → Inventario crítico.
--
-- NO DUPLICA LO QUE YA ESTA
-- La goma de clamp de 1,5" ya entró con la planilla de planta como FAB-047
-- ("Junta clamp 1,5'' silicona"): a esa sólo se le pone el mínimo. Los otros
-- siete se buscan por nombre antes de crearse, por si ya estaban con otro
-- nombre, y recién si no aparecen se dan de alta.
--
-- UNIDADES
-- Los líquidos van en LITROS y el sanitizante en MILILITROS, no en "bidones":
-- un bidón empezado no es media compra, y el ERP necesita el número para
-- descontar y para avisar. La equivalencia de la planilla queda en el mínimo:
--   Hiperacético  1 bidón de 5 L  →   5 L
--   Alcohol       2 bidones de 5 L → 10 L
--   Lavandina     2 bidones de 5 L → 10 L
--   StarSan       4 onzas         → 118 ML
-- Las gomas, tapas, botellas y el balón de CO2 se cuentan por unidad.
--
-- EL STOCK NO SE TOCA. El script carga el mínimo, no la existencia: lo que hay
-- se carga desde Inventario, para que el kardex lo explique. Los insumos que
-- se crean acá nacen en 0 y sin control de stock, así no figuran como críticos
-- hasta que alguien los cuente por primera vez.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $criticos$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';  -- Cervecería
  v_cat_nombre CONSTANT text := 'Insumos críticos de planta';

  r        record;
  v_cat    uuid;
  v_prod   uuid;
  v_nuevo  integer := 0;
  v_actual integer := 0;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Categoría
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_cat FROM cerveceriaerp.categorias_productos
   WHERE empresa_id = v_empresa AND upper(nombre) = upper(v_cat_nombre);
  IF v_cat IS NULL THEN
    INSERT INTO cerveceriaerp.categorias_productos (empresa_id, nombre, codigo, activo)
    VALUES (v_empresa, v_cat_nombre, 'INSCRIT', true)
    RETURNING id INTO v_cat;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Los 8 puntos críticos
  -- ---------------------------------------------------------------------------
  -- `buscar` es la expresión con la que se intenta encontrar el insumo si ya
  -- existe con otro nombre o SKU. `\m` ancla al PRINCIPIO DE PALABRA, y no es
  -- un detalle: con un LIKE '%botella%' suelto, "Grifo plástico para cubo de
  -- embotellado" contiene "botella" y se lleva el mínimo de las botellas.
  FOR r IN
    SELECT * FROM (VALUES
      ('FAB-047',      'Junta clamp 1,5'''' silicona (goma de clamp)', 'UNIDAD',   8::numeric,   '\mjunta clamp 1,5'),
      ('INS-HIPERAC',  'Ácido hiperacético',                          'L',        5::numeric,   '\mhiperac'),
      ('INS-STARSAN',  'StarSan (sanitizante)',                       'ML',     118::numeric,   '\mstar ?san'),
      ('INS-ALCOHOL',  'Alcohol',                                     'L',       10::numeric,   '\malcohol'),
      ('INS-LAVANDINA','Lavandina',                                   'L',       10::numeric,   '\mlavandina'),
      ('INS-TAPA',     'Tapas corona',                                'UNIDAD', 100::numeric,   '\mtapas? corona'),
      ('INS-BOTELLA',  'Botellas',                                    'UNIDAD',  50::numeric,   '\mbotellas?\M'),
      ('INS-CO2',      'CO2 (balón de 7 litros)',                     'UNIDAD',   1::numeric,   '\mco2\M')
    ) AS t(sku, nombre, unidad, minimo, buscar)
  LOOP
    -- Por SKU primero: es el único identificador estable.
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;

    -- Si no está, por nombre: la planilla de planta pudo haberlo cargado con
    -- otro texto, y crear un segundo "Alcohol" partiría el stock en dos.
    IF v_prod IS NULL AND r.buscar IS NOT NULL THEN
      SELECT id INTO v_prod FROM cerveceriaerp.productos
       WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal
         AND nombre ~* r.buscar
       ORDER BY created_at
       LIMIT 1;
    END IF;

    IF v_prod IS NULL THEN
      -- Nace en 0 y SIN control de stock, a propósito: con control en 0
      -- aparecería como crítico desde el minuto uno, cuando en realidad sólo
      -- falta contarlo. Una alerta que es falsa el primer día es una alerta
      -- que nadie mira el segundo. Se prende al cargar la existencia (ver el
      -- bloque del final).
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, stock_minimo, activo, controla_stock,
         es_insumo, es_vendible, categoria_principal_id)
      VALUES
        (v_empresa, v_sucursal, r.nombre, r.sku, r.unidad, 0,
         0, 0, r.minimo, true, false,
         true, false, v_cat)
      RETURNING id INTO v_prod;
      v_nuevo := v_nuevo + 1;
      RAISE NOTICE 'Creado % (% %) con minimo %', r.sku, r.nombre, r.unidad, r.minimo;
    ELSE
      -- Ya existía: SOLO el mínimo y la marca de insumo. Ni el nombre ni el
      -- stock se pisan — el stock lo mueve el ERP y el nombre puede estar
      -- mejor puesto que el de esta lista.
      UPDATE cerveceriaerp.productos
         SET stock_minimo = r.minimo,
             es_insumo = true,
             updated_at = now()
       WHERE id = v_prod;
      v_actual := v_actual + 1;
      RAISE NOTICE 'Actualizado minimo de % -> %', r.sku, r.minimo;
    END IF;
  END LOOP;

  RAISE NOTICE 'Puntos criticos: % creados, % ya existian.', v_nuevo, v_actual;
END
$criticos$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación: los 8, con su mínimo y cómo están hoy
-- ---------------------------------------------------------------------------
SELECT p.sku,
       p.nombre,
       p.unidad_medida,
       p.stock_minimo,
       p.stock_actual,
       p.controla_stock,
       CASE
         WHEN NOT p.controla_stock         THEN 'sin contar todavia'
         WHEN p.stock_actual <= p.stock_minimo THEN 'CRITICO: avisa'
         ELSE 'ok'
       END AS estado
  FROM cerveceriaerp.productos p
 WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND (p.sku LIKE 'INS-%' OR p.sku = 'FAB-047')
 ORDER BY p.sku;
-- Esperado: 8 filas.

-- ---------------------------------------------------------------------------
-- Para prender la alerta de cada insumo: cargar lo que hay
-- ---------------------------------------------------------------------------
-- Mientras `controla_stock` esté en false el insumo no avisa nunca. Se prende
-- cargando la existencia, de una de estas dos formas:
--
-- A) Desde la pantalla (lo normal): Inventario → el producto → Editar, marcar
--    que controla stock y guardar; después Inventario → Movimientos → Entrada
--    con lo contado. El kardex queda explicando de dónde salió ese stock.
--
-- B) Desde acá, para la primera carga de todos juntos. Cambiar la cantidad de
--    cada línea y descomentar. Deja el movimiento de inventario inicial, igual
--    que la planilla de planta:
--
-- DO $carga$
-- DECLARE
--   v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
--   v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';
--   r record; v_prod uuid; v_nombre text;
-- BEGIN
--   FOR r IN SELECT * FROM (VALUES
--     ('INS-HIPERAC',   0::numeric),
--     ('INS-STARSAN',   0::numeric),
--     ('INS-ALCOHOL',   0::numeric),
--     ('INS-LAVANDINA', 0::numeric),
--     ('INS-TAPA',      0::numeric),
--     ('INS-BOTELLA',   0::numeric),
--     ('INS-CO2',       0::numeric)
--   ) AS t(sku, contado)
--   LOOP
--     SELECT id, nombre INTO v_prod, v_nombre FROM cerveceriaerp.productos
--      WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
--     IF v_prod IS NULL THEN CONTINUE; END IF;
--     UPDATE cerveceriaerp.productos
--        SET stock_actual = r.contado, controla_stock = true, updated_at = now()
--      WHERE id = v_prod;
--     IF r.contado > 0 THEN
--       INSERT INTO cerveceriaerp.movimientos_inventario
--         (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
--          tipo, cantidad, costo_unitario, origen, referencia)
--       VALUES (v_empresa, v_sucursal, v_prod, v_nombre, r.sku,
--               'ENTRADA', r.contado, 0, 'inventario_inicial',
--               'Conteo inicial de puntos criticos');
--     END IF;
--   END LOOP;
-- END
-- $carga$;
-- NOTIFY pgrst, 'reload schema';
