\set empresa '0cbefe95-4007-402c-97de-70147f9d39bb'
\echo '>> conteos (deben ser iguales tras las dos corridas)'
SELECT 'proveedores' q, count(*) FROM cerveceriaerp.proveedores WHERE empresa_id = :'empresa'
UNION ALL SELECT 'insumos',  count(*) FROM cerveceriaerp.productos WHERE empresa_id = :'empresa' AND es_insumo
UNION ALL SELECT 'graneles', count(*) FROM cerveceriaerp.productos WHERE sku LIKE 'CV-%GRANEL'
UNION ALL SELECT 'recetas',  count(*) FROM cerveceriaerp.recetas WHERE empresa_id = :'empresa'
UNION ALL SELECT 'receta_items', count(*) FROM cerveceriaerp.receta_items WHERE empresa_id = :'empresa'
UNION ALL SELECT 'lotes',    count(*) FROM cerveceriaerp.produccion_lotes WHERE empresa_id = :'empresa'
UNION ALL SELECT 'etapas',   count(*) FROM cerveceriaerp.produccion_lote_etapas WHERE empresa_id = :'empresa'
ORDER BY 1;

\echo '>> NINGUN movimiento de inventario y NINGUN stock tocado'
SELECT count(*) AS movimientos FROM cerveceriaerp.movimientos_inventario;
SELECT count(*) AS productos_con_stock_distinto_de_cero
  FROM cerveceriaerp.productos WHERE stock_actual <> 0;

\echo '>> recetas: cuales quedan activas'
SELECT nombre, rendimiento_cantidad, rendimiento_unidad, activa
  FROM cerveceriaerp.recetas WHERE empresa_id = :'empresa' ORDER BY nombre;

\echo '>> costeo de la Session IPA 500 L (unica con rendimiento real)'
SELECT round((cerveceriaerp.fn_receta_costeo('a1b0c3d4-0001-4a00-9000-000000000001')->>'costo_total')::numeric) AS costo_total,
       round((cerveceriaerp.fn_receta_costeo('a1b0c3d4-0001-4a00-9000-000000000001')->>'costo_unitario')::numeric) AS costo_por_litro;

\echo '>> lotes cargados'
SELECT codigo, estado, volumen_planificado, fecha_inicio::date
  FROM cerveceriaerp.produccion_lotes WHERE empresa_id = :'empresa' ORDER BY codigo;
