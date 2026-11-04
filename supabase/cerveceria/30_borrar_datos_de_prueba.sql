-- =============================================================================
-- 30. Borrar los datos de prueba (arranque en limpio)
-- =============================================================================
--
-- QUE BORRA
-- Todo lo que se MOVIO durante las pruebas: ventas, facturas, cobros, recibos,
-- deuda, compras, gastos, movimientos de stock, cajas y sus movimientos,
-- pedidos y mesas abiertas, lotes de producción, reposiciones y presupuestos.
--
-- QUE NO BORRA
-- El catálogo, que es trabajo cargado a mano y se sigue usando: productos,
-- categorías, ubicaciones, recetas, proveedores, clientes, sucursales,
-- usuarios, fermentadores y las mesas del salón. Si hay un producto o un
-- cliente de prueba, se borra desde la pantalla, de a uno, mirando lo que se
-- borra: un DELETE masivo sobre el catálogo se lleva puesto lo bueno con lo
-- malo.
--
-- NO HAY LISTA DE NOMBRES ESCRITA A MANO. Una lista escrita a mano envejece:
-- aparece una tabla nueva que cuelga de las ventas, nadie la agrega, y el
-- borrado se corta a mitad de camino con un error de clave foránea. Acá el
-- script arranca de las tablas de movimiento y despues PREGUNTA A LA BASE
-- quién las referencia, hasta abajo. Y borra en el orden que la base acepte:
-- si una tabla todavía está referenciada, la deja para la vuelta siguiente.
--
-- EL STOCK VUELVE A CERO. No es un extra: los movimientos son los que explican
-- el stock. Si se borran los movimientos y el stock queda cargado, cada
-- producto queda con una cantidad que ningún papel respalda.
--
-- ESTO NO SE DESHACE. Antes de correrlo, hacé un backup en Supabase
-- (Database → Backups). Si algo sale mal, el backup es la única vuelta atrás.
--
-- Se corre en DOS PASOS: primero el paso 1 para ver qué se va a borrar, y
-- recién después el paso 2. Todo dentro de una transacción: si falla algo,
-- no queda nada a medias.
--
-- Sólo toca `cerveceriaerp`.
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
  -- Las tablas de movimiento de las que arranca todo. De acá para abajo, la
  -- base dice qué más cae: lo que cuelgue de estas entra solo.
  semillas text[] := ARRAY[
    'ventas', 'facturas', 'cuentas_por_cobrar', 'cobros_clientes',
    'pagos', 'gastos',
    'compras', 'cuentas_por_pagar', 'ordenes_compra',
    'cajas', 'proyectos', 'presupuestos',
    'produccion_lotes', 'producciones',
    'transferencias_inventario', 'transferencias',
    'movimientos_inventario', 'inventario_stock_ubicacion',
    'sifen_jobs'
  ];

  -- El catálogo, explícito. Si alguna de estas llegara a colgar de una tabla
  -- de movimiento, igual no se toca: es el trabajo cargado a mano.
  protegidas text[] := ARRAY[
    'empresas', 'sucursales', 'usuarios', 'usuario_sucursales',
    'modulos', 'empresa_modulos', 'usuario_modulos',
    'planes', 'suscripciones',
    'productos', 'producto_categorias', 'categorias_productos',
    'inventario_ubicaciones',
    'clientes', 'proveedores', 'proveedor_productos',
    'recetas', 'receta_items', 'receta_formatos', 'receta_costos_operacion',
    'fermentadores', 'mesas',
    'proyecto_estados', 'proyecto_tipos', 'proyecto_prioridades_config',
    'costeo_parametros', 'tipificaciones',
    'empresa_facturacion_modo', 'empresa_sifen_config',
    'dashboard_views', 'empresa_dashboard_views', 'usuario_dashboard_views',
    'obligaciones_tributarias_catalogo', 'cliente_tipos_servicio_catalogo',
    'cliente_perfil_tributario', 'cliente_obligaciones_tributarias'
  ];

  pendientes text[] := '{}';
  nuevas     text[];
  t          text;
  resto      text[];
  borradas   bigint;
  total      bigint := 0;
  avanzo     boolean;
  vueltas    integer := 0;
BEGIN
  -- --- 1) Las semillas que existen de verdad en esta instancia -------------
  SELECT coalesce(array_agg(c.relname::text), '{}')
    INTO pendientes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cerveceriaerp'
     AND c.relkind = 'r'
     AND c.relname::text = ANY (semillas)
     AND NOT (c.relname::text = ANY (protegidas));

  -- --- 2) Quién las referencia, hasta abajo --------------------------------
  -- Las familias que no son del ERP (chat, sorteos, marketing, comisiones,
  -- CRM) quedan afuera: no son datos de prueba de esto.
  LOOP
    SELECT coalesce(array_agg(DISTINCT hijo.relname::text), '{}')
      INTO nuevas
      FROM pg_constraint fk
      JOIN pg_class hijo  ON hijo.oid  = fk.conrelid
      JOIN pg_class padre ON padre.oid = fk.confrelid
      JOIN pg_namespace nh ON nh.oid = hijo.relnamespace
      JOIN pg_namespace np ON np.oid = padre.relnamespace
     WHERE fk.contype = 'f'
       AND nh.nspname = 'cerveceriaerp'
       AND np.nspname = 'cerveceriaerp'
       AND padre.relname::text = ANY (pendientes)
       AND NOT (hijo.relname::text = ANY (pendientes))
       AND NOT (hijo.relname::text = ANY (protegidas))
       AND hijo.relname::text NOT LIKE 'chat\_%'
       AND hijo.relname::text NOT LIKE 'sorteo%'
       AND hijo.relname::text NOT LIKE 'marketing\_%'
       AND hijo.relname::text NOT LIKE 'comision\_%'
       AND hijo.relname::text NOT LIKE 'crm\_%';

    EXIT WHEN cardinality(nuevas) = 0;
    pendientes := pendientes || nuevas;
    FOREACH t IN ARRAY nuevas LOOP
      RAISE NOTICE 'Cuelga de una tabla de movimiento, también se borra: %', t;
    END LOOP;
  END LOOP;

  -- --- 3) Borrar en el orden que la base acepte ----------------------------
  -- Nadie calcula el orden a mano: se intenta, y la tabla que todavía está
  -- referenciada espera la vuelta siguiente. Mientras una vuelta logre borrar
  -- algo, se sigue.
  LOOP
    vueltas := vueltas + 1;
    avanzo  := false;
    resto   := '{}';

    FOREACH t IN ARRAY pendientes LOOP
      BEGIN
        EXECUTE format('DELETE FROM cerveceriaerp.%I', t);
        GET DIAGNOSTICS borradas = ROW_COUNT;
        total  := total + borradas;
        avanzo := true;
        IF borradas > 0 THEN
          RAISE NOTICE '% : % filas borradas', t, borradas;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Todavía la referencia un hijo que no se borró aún.
        resto := resto || t;
      END;
    END LOOP;

    pendientes := resto;
    EXIT WHEN cardinality(pendientes) = 0;

    IF NOT avanzo THEN
      -- Sin vuelta atrás posible: un ciclo de claves foráneas, o un hijo que
      -- quedó afuera por protegido. Mejor cortar todo que dejar la mitad.
      RAISE EXCEPTION 'No se pudo terminar de borrar: % quedaron referenciadas. No se borró nada.',
        array_to_string(pendientes, ', ');
    END IF;
  END LOOP;

  -- --- 4) El stock vuelve a cero -------------------------------------------
  -- Sin movimientos, una cantidad cargada no la explica nadie.
  UPDATE cerveceriaerp.productos
     SET stock_actual = 0
   WHERE stock_actual IS DISTINCT FROM 0;
  GET DIAGNOSTICS borradas = ROW_COUNT;

  RAISE NOTICE '---';
  RAISE NOTICE 'Filas de movimiento borradas: % (en % vueltas)', total, vueltas;
  RAISE NOTICE 'Productos con el stock vuelto a cero: %', borradas;
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
