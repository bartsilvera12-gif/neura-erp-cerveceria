-- =============================================================================
-- 19. Carta del Bar de Coven
-- =============================================================================
--
-- QUE CARGA
-- Los 7 menús de la carta, más la gaseosa de 500 y el agua, en la sucursal
-- BAR. Las 5 pizzas van como productos separados: la cocina necesita saber
-- cuál sale, y "Pizzas del aquelarre" en la comanda no le dice nada a nadie.
--
-- LAS COMIDAS NO DESCUENTAN STOCK
-- Entran como producto de menú sin receta: se venden, salen en la comanda y no
-- tocan el inventario. Para que una hamburguesa descuente pan, carne y queso
-- hace falta cargar esos insumos y la receta de cada plato — es otro trabajo,
-- y hasta que esté es mejor no descontar nada que descontar mal.
--
-- La gaseosa y el agua SI controlan stock: son reventa, se compran hechas y se
-- cuentan.
--
-- LOS PRECIOS VAN EN CERO
-- La carta no los trae. Quedan en 0 y hay un bloque al final para cargarlos
-- todos juntos. OJO: un producto en 0 se puede vender en 0 — cargá los precios
-- antes de abrir la caja del bar.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $carta$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_bar      CONSTANT uuid := 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31';  -- sucursal Bar

  r          record;
  v_cat      uuid;
  v_prod     uuid;
  v_hay_iva  boolean;
  v_nuevos   integer := 0;
  v_existian integer := 0;
BEGIN
  -- ¿La tabla tiene `tipo_iva`? En esta instalación sí, pero el script no lo
  -- asume: se consulta y se completa sólo si está.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'cerveceriaerp' AND table_name = 'productos' AND column_name = 'tipo_iva'
  ) INTO v_hay_iva;

  -- ---------------------------------------------------------------------------
  -- 1. Categorías
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM (VALUES
    ('Comidas del bar', 'COMIDA'),
    ('Bebidas sin alcohol', 'BEBSIN')
  ) AS t(nombre, codigo)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.categorias_productos
                    WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.nombre)) THEN
      INSERT INTO cerveceriaerp.categorias_productos (empresa_id, nombre, codigo, activo)
      VALUES (v_empresa, r.nombre, r.codigo, true);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. La carta
  -- ---------------------------------------------------------------------------
  -- `controla` = true sólo para lo que se compra hecho y se cuenta.
  FOR r IN SELECT * FROM (VALUES
    ('BAR-MENU-01',  'Menú 1 · Ritual del Maestro Cervecero', 'Comidas del bar',     false),
    ('BAR-MENU-02',  'Menú 2 · La Picada del Brewer',         'Comidas del bar',     false),
    ('BAR-PIZZA-4Q', 'Pizza Cuatro Quesos',                   'Comidas del bar',     false),
    ('BAR-PIZZA-NAP','Pizza Napolitana',                      'Comidas del bar',     false),
    ('BAR-PIZZA-PEP','Pizza Peperoni',                        'Comidas del bar',     false),
    ('BAR-PIZZA-PRI','Pizza Primavera',                       'Comidas del bar',     false),
    ('BAR-PIZZA-CAS','Pizza de la Casa',                      'Comidas del bar',     false),
    ('BAR-MENU-04',  'Menú 4 · Hamburguesa',                  'Comidas del bar',     false),
    ('BAR-MENU-05',  'Menú 5 · Papas Malteadas',              'Comidas del bar',     false),
    ('BAR-MENU-06',  'Menú 6 · Original Coven',               'Comidas del bar',     false),
    ('BAR-MENU-07',  'Menú 7 · El Barrilero',                 'Comidas del bar',     false),
    ('BAR-GASEOSA-500', 'Gaseosa 500 ml',                     'Bebidas sin alcohol', true),
    ('BAR-AGUA-500',    'Agua 500 ml',                        'Bebidas sin alcohol', true)
  ) AS t(sku, nombre, categoria, controla)
  LOOP
    SELECT id INTO v_cat FROM cerveceriaerp.categorias_productos
     WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.categoria);

    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_bar AND sku = r.sku;

    IF v_prod IS NULL THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, stock_minimo, activo, controla_stock,
         es_insumo, es_vendible, modo_receta, categoria_principal_id)
      VALUES
        (v_empresa, v_bar, r.nombre, r.sku, 'UNIDAD', 0,
         0, 0, 0, true, r.controla,
         false, true, 'preparado_al_vender', v_cat)
      RETURNING id INTO v_prod;
      v_nuevos := v_nuevos + 1;
    ELSE
      -- Ya estaba: se respeta el precio y el stock que tenga cargados. Sólo se
      -- refresca lo que define qué ES el producto.
      UPDATE cerveceriaerp.productos
         SET nombre = r.nombre,
             es_vendible = true,
             categoria_principal_id = coalesce(categoria_principal_id, v_cat),
             updated_at = now()
       WHERE id = v_prod;
      v_existian := v_existian + 1;
    END IF;

    -- Comida y bebida van al 10%, como el resto de la carta.
    IF v_hay_iva THEN
      EXECUTE 'UPDATE cerveceriaerp.productos SET tipo_iva = ''10'' WHERE id = $1 AND (tipo_iva IS NULL OR tipo_iva = '''')'
        USING v_prod;
    END IF;
  END LOOP;

  RAISE NOTICE 'Carta del bar: % nuevos, % ya existian.', v_nuevos, v_existian;
  RAISE NOTICE 'Los precios quedan en 0: cargalos antes de vender.';
END
$carta$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT p.sku, p.nombre, p.precio_venta, p.controla_stock, p.stock_actual, c.nombre AS categoria
  FROM cerveceriaerp.productos p
  LEFT JOIN cerveceriaerp.categorias_productos c ON c.id = p.categoria_principal_id
 WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND p.sucursal_id = 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31'
   AND p.sku LIKE 'BAR-%'
 ORDER BY p.sku;
-- Esperado: 13 filas (11 comidas + 2 bebidas), todas con precio 0 la primera vez.

-- ---------------------------------------------------------------------------
-- Los precios, de una
-- ---------------------------------------------------------------------------
-- Poné el precio de cada uno y descomentá. Se puede correr las veces que haga
-- falta; también se pueden cargar uno por uno desde Inventario.
--
-- UPDATE cerveceriaerp.productos p
--    SET precio_venta = v.precio, updated_at = now()
--   FROM (VALUES
--     ('BAR-MENU-01',     0::numeric),
--     ('BAR-MENU-02',     0::numeric),
--     ('BAR-PIZZA-4Q',    0::numeric),
--     ('BAR-PIZZA-NAP',   0::numeric),
--     ('BAR-PIZZA-PEP',   0::numeric),
--     ('BAR-PIZZA-PRI',   0::numeric),
--     ('BAR-PIZZA-CAS',   0::numeric),
--     ('BAR-MENU-04',     0::numeric),
--     ('BAR-MENU-05',     0::numeric),
--     ('BAR-MENU-06',     0::numeric),
--     ('BAR-MENU-07',     0::numeric),
--     ('BAR-GASEOSA-500', 0::numeric),
--     ('BAR-AGUA-500',    0::numeric)
--   ) AS v(sku, precio)
--  WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
--    AND p.sucursal_id = 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31'
--    AND p.sku = v.sku;
-- NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- La gaseosa y el agua se cuentan
-- ---------------------------------------------------------------------------
-- Entran por Compras (así cargan su costo) o por Inventario → Movimientos →
-- Entrada. Si querés que avisen cuando se estén terminando, ponele stock
-- mínimo desde la ficha del producto: con eso aparecen en la campanita.
