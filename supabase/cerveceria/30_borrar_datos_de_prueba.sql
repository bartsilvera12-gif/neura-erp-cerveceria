-- =============================================================================
-- 30. Borrar los datos de prueba (arranque en limpio)
-- =============================================================================
--
-- QUE BORRA
-- Todo lo que se MOVIO durante las pruebas: ventas, facturas, cobros, deuda,
-- compras, gastos, movimientos de stock, cajas y sus movimientos, pedidos y
-- mesas abiertas, lotes de producción, reposiciones y presupuestos.
--
-- QUE NO BORRA
-- El catálogo, que es trabajo cargado a mano y se sigue usando: productos,
-- categorías, ubicaciones, recetas, proveedores, clientes, sucursales,
-- usuarios, fermentadores y las mesas del salón. Si hay un producto o un
-- cliente de prueba, se borra desde la pantalla, de a uno, mirando lo que se
-- borra: un DELETE masivo sobre el catálogo se lleva puesto lo bueno con lo
-- malo.
--
-- EL STOCK VUELVE A CERO. No es un extra: los movimientos son los que explican
-- el stock. Si se borran los movimientos y el stock queda cargado, cada
-- producto queda con una cantidad que ningún papel respalda.
--
-- ESTO NO SE DESHACE. Antes de correrlo, hacé un backup en Supabase
-- (Database → Backups). Si algo sale mal, el backup es la única vuelta atrás.
--
-- Se corre en DOS PASOS: primero el paso 1 para ver qué se va a borrar, y
-- recién después el paso 2.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — Qué hay cargado hoy (no borra nada)
-- ---------------------------------------------------------------------------
SELECT t.tabla, t.cuantos
  FROM (
    SELECT 'ventas'                  AS tabla, count(*) AS cuantos FROM cerveceriaerp.ventas
    UNION ALL SELECT 'facturas',               count(*) FROM cerveceriaerp.facturas
    UNION ALL SELECT 'cuentas_por_cobrar',     count(*) FROM cerveceriaerp.cuentas_por_cobrar
    UNION ALL SELECT 'cobros_clientes',        count(*) FROM cerveceriaerp.cobros_clientes
    UNION ALL SELECT 'compras',                count(*) FROM cerveceriaerp.compras
    UNION ALL SELECT 'cuentas_por_pagar',      count(*) FROM cerveceriaerp.cuentas_por_pagar
    UNION ALL SELECT 'gastos',                 count(*) FROM cerveceriaerp.gastos
    UNION ALL SELECT 'movimientos_inventario', count(*) FROM cerveceriaerp.movimientos_inventario
    UNION ALL SELECT 'cajas',                  count(*) FROM cerveceriaerp.cajas
    UNION ALL SELECT 'proyectos (pedidos y mesas)', count(*) FROM cerveceriaerp.proyectos
    UNION ALL SELECT 'produccion_lotes',       count(*) FROM cerveceriaerp.produccion_lotes
    UNION ALL SELECT 'presupuestos',           count(*) FROM cerveceriaerp.presupuestos
  ) t
 WHERE t.cuantos > 0
 ORDER BY t.cuantos DESC;

-- Y lo que NO se toca, para que quede claro qué sobrevive:
SELECT 'productos'   AS catalogo, count(*) AS cuantos FROM cerveceriaerp.productos
UNION ALL SELECT 'clientes',      count(*) FROM cerveceriaerp.clientes
UNION ALL SELECT 'proveedores',   count(*) FROM cerveceriaerp.proveedores
UNION ALL SELECT 'recetas',       count(*) FROM cerveceriaerp.recetas
UNION ALL SELECT 'mesas',         count(*) FROM cerveceriaerp.mesas;


-- ---------------------------------------------------------------------------
-- PASO 2 — Borrar (recién después de mirar el paso 1 y de hacer el backup)
-- ---------------------------------------------------------------------------
BEGIN;

DO $limpiar$
DECLARE
  t        text;
  borradas bigint;
  total    bigint := 0;
  -- En orden: primero los hijos, después los padres. Una tabla que no exista
  -- en esta instancia se saltea sin romper nada.
  tablas text[] := ARRAY[
    -- Ventas y su cobranza
    'ventas_items', 'cobros_clientes', 'recibos', 'cuentas_por_cobrar',
    'notas_credito_items', 'notas_credito',
    'factura_items', 'facturas_sifen_eventos', 'facturas',
    'pagos', 'ventas',
    -- Compras y su deuda
    'compras_items', 'notas_credito_compra_items', 'notas_credito_compra',
    'pagos_proveedores', 'cuotas_cuenta_por_pagar', 'cuentas_por_pagar',
    'ordenes_compra_items', 'ordenes_compra', 'compras',
    -- Gastos
    'gastos',
    -- Caja
    'caja_movimientos', 'cajas',
    -- Pedidos, mesas y presupuestos
    'proyecto_tareas', 'proyecto_comentarios', 'proyecto_archivos',
    'proyecto_historial_estados', 'proyectos',
    'presupuesto_items', 'presupuestos',
    -- Producción
    'produccion_mediciones', 'produccion_lote_envasado', 'produccion_lote_etapas',
    'produccion_lotes', 'produccion_consumos', 'producciones',
    -- Reposición entre sucursales
    'transferencias_items', 'transferencias',
    -- Stock: va al final, porque es lo que explica todo lo de arriba
    'inventario_stock_ubicacion', 'movimientos_inventario'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'cerveceriaerp' AND table_name = t
    ) THEN
      EXECUTE format('DELETE FROM cerveceriaerp.%I', t);
      GET DIAGNOSTICS borradas = ROW_COUNT;
      total := total + borradas;
      IF borradas > 0 THEN
        RAISE NOTICE '% : % filas borradas', t, borradas;
      END IF;
    END IF;
  END LOOP;

  -- El stock vuelve a cero: sin movimientos, una cantidad cargada no la
  -- explica nadie.
  UPDATE cerveceriaerp.productos
     SET stock_actual = 0
   WHERE stock_actual IS DISTINCT FROM 0;
  GET DIAGNOSTICS borradas = ROW_COUNT;
  RAISE NOTICE 'Productos con el stock vuelto a cero: %', borradas;

  RAISE NOTICE 'Total de filas de movimiento borradas: %', total;
END
$limpiar$;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ---------------------------------------------------------------------------
-- PASO 3 — Cómo quedó
-- ---------------------------------------------------------------------------
SELECT 'ventas' AS tabla, count(*) AS cuantos FROM cerveceriaerp.ventas
UNION ALL SELECT 'movimientos_inventario', count(*) FROM cerveceriaerp.movimientos_inventario
UNION ALL SELECT 'cajas',                   count(*) FROM cerveceriaerp.cajas
UNION ALL SELECT 'proyectos',               count(*) FROM cerveceriaerp.proyectos
UNION ALL SELECT 'produccion_lotes',        count(*) FROM cerveceriaerp.produccion_lotes
UNION ALL SELECT 'compras',                 count(*) FROM cerveceriaerp.compras
UNION ALL SELECT 'gastos',                  count(*) FROM cerveceriaerp.gastos
ORDER BY 1;

-- Después de esto, el stock real se carga con un movimiento de ENTRADA por
-- producto (Inventario → Movimientos → Nuevo), o desde una compra. Así cada
-- cantidad tiene su papel detrás desde el primer día.
