\set empresa '0cbefe95-4007-402c-97de-70147f9d39bb'
\echo '>> conteos (deben ser iguales tras las dos corridas)'
SELECT 'proveedores' q, count(*) FROM cerveceriaerp.proveedores WHERE empresa_id = :'empresa'
UNION ALL SELECT 'insumos',  count(*) FROM cerveceriaerp.productos WHERE empresa_id = :'empresa' AND es_insumo
UNION ALL SELECT 'graneles', count(*) FROM cerveceriaerp.productos WHERE sku LIKE 'CV-%GRANEL%'
UNION ALL SELECT 'recetas',  count(*) FROM cerveceriaerp.recetas WHERE empresa_id = :'empresa'
UNION ALL SELECT 'receta_items', count(*) FROM cerveceriaerp.receta_items WHERE empresa_id = :'empresa'
UNION ALL SELECT 'lotes',    count(*) FROM cerveceriaerp.produccion_lotes WHERE empresa_id = :'empresa'
UNION ALL SELECT 'etapas',   count(*) FROM cerveceriaerp.produccion_lote_etapas WHERE empresa_id = :'empresa'
ORDER BY 1;

\echo '>> el script 12 no mueve stock: los lotes entran como historia'
-- Los movimientos que SI tiene que haber son los del inventario de planta
-- (script 13) y los de las compras historicas (15). Ningun otro.
SELECT count(*) AS movimientos_inesperados
  FROM cerveceriaerp.movimientos_inventario
 WHERE usuario_nombre IS DISTINCT FROM 'Carga historica'
   AND producto_sku NOT LIKE 'FAB-%';
SELECT count(*) AS graneles_o_vendibles_con_stock
  FROM cerveceriaerp.productos
 WHERE stock_actual <> 0 AND NOT es_insumo AND sku NOT LIKE 'FAB-%';

\echo '>> recetas: cuales quedan activas'
SELECT nombre, rendimiento_cantidad, rendimiento_unidad, activa
  FROM cerveceriaerp.recetas WHERE empresa_id = :'empresa' ORDER BY nombre;

\echo '>> costeo de la Session IPA 500 L (unica con rendimiento real)'
SELECT round((cerveceriaerp.fn_receta_costeo('a1b0c3d4-0001-4a00-9000-000000000001')->>'costo_total')::numeric) AS costo_total,
       round((cerveceriaerp.fn_receta_costeo('a1b0c3d4-0001-4a00-9000-000000000001')->>'costo_unitario')::numeric) AS costo_por_litro;

\echo '>> lotes cargados'
SELECT codigo, estado, volumen_planificado, fecha_inicio::date
  FROM cerveceriaerp.produccion_lotes WHERE empresa_id = :'empresa' ORDER BY codigo;

\echo '>> inventario de planta: por ubicacion'
SELECT u.nombre AS ubicacion, count(*) AS articulos, sum(p.stock_actual) AS unidades,
       count(*) FILTER (WHERE NOT p.controla_stock) AS sin_contar
  FROM cerveceriaerp.productos p
  JOIN cerveceriaerp.inventario_ubicaciones u ON u.id = p.ubicacion_principal_id
 WHERE p.sku LIKE 'FAB-%' GROUP BY u.nombre ORDER BY u.nombre;

\echo '>> el stock de planta tiene que cuadrar con sus movimientos (sin duplicar tras 2 corridas)'
SELECT (SELECT sum(stock_actual) FROM cerveceriaerp.productos WHERE sku LIKE 'FAB-%') AS stock,
       (SELECT sum(cantidad) FROM cerveceriaerp.movimientos_inventario
         WHERE producto_sku LIKE 'FAB-%' AND tipo='ENTRADA') AS movimientos,
       (SELECT count(*) FROM cerveceriaerp.movimientos_inventario WHERE producto_sku LIKE 'FAB-%') AS n_mov;

\echo '>> la cerveza sigue sin mover stock'
SELECT count(*) AS movimientos_no_planta FROM cerveceriaerp.movimientos_inventario
 WHERE producto_sku NOT LIKE 'FAB-%';

\echo '>> compras historicas (iguales tras las dos corridas)'
SELECT (SELECT count(*) FROM cerveceriaerp.compras WHERE numero_control LIKE 'HIST-%') AS compras,
       (SELECT count(DISTINCT numero_control) FROM cerveceriaerp.compras WHERE numero_control LIKE 'HIST-%') AS lotes,
       (SELECT count(*) FROM cerveceriaerp.movimientos_inventario WHERE usuario_nombre='Carga historica') AS movimientos;

\echo '>> el stock de los insumos tiene que quedar en 0: lo que entro salio'
SELECT count(*) FILTER (WHERE round(stock_actual,6) <> 0) AS insumos_con_stock_distinto_de_cero,
       count(*) FILTER (WHERE costo_promedio > 0)         AS insumos_con_costo,
       count(*)                                           AS insumos
  FROM cerveceriaerp.productos WHERE es_insumo;

\echo '>> entradas y salidas de insumos tienen que cuadrar'
SELECT tipo, round(sum(cantidad),4) AS cantidad, count(*) AS n
  FROM cerveceriaerp.movimientos_inventario
 WHERE usuario_nombre='Carga historica' GROUP BY tipo ORDER BY tipo;

\echo '>> total comprado por lote (tiene que dar igual que la planilla)'
SELECT numero_control, round(sum(total)) AS total_gs
  FROM cerveceriaerp.compras WHERE numero_control LIKE 'HIST-%'
 GROUP BY numero_control ORDER BY numero_control;

\echo '>> y el costeo de las recetas activas ya no da 0'
SELECT r.nombre,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_total')::numeric)    AS costo_lote,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_unitario')::numeric) AS por_litro
  FROM cerveceriaerp.recetas r WHERE r.activa ORDER BY r.nombre;

\echo '>> el costo no puede depender del azar: tiene que dar esto siempre'
SELECT sku, round(costo_promedio, 2) AS costo
  FROM cerveceriaerp.productos
 WHERE es_insumo AND sku IN ('LU-MAGNUM','LU-CENTENNIAL','LU-CASCADE','LV-NEWE')
 ORDER BY sku;
-- Esperado: LU-CASCADE 538 · LU-CENTENNIAL 538 · LU-MAGNUM 540 · LV-NEWE 63545.45
