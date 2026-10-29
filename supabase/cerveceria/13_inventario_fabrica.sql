-- =============================================================================
-- 13. Inventario de planta
-- =============================================================================
--
-- Los 57 articulos de ferreteria y repuestos de `inventario-fabrica.xlsx`, con
-- la ubicacion fisica donde estan guardados (13 ubicaciones: tuppers y cajas).
--
-- A DIFERENCIA DEL SCRIPT 12, ESTE SI CARGA STOCK.
-- Los lotes de cerveza del 12 ya se consumieron y por eso entraron como
-- historia. Estos repuestos estan HOY en el deposito, asi que el stock es real
-- y se carga con un movimiento `inventario_inicial`, igual que lo haria la
-- pantalla de Inventario. Asi el kardex explica de donde salio cada cantidad
-- en vez de aparecer un stock sin origen.
--
-- LOS 10 ARTICULOS SIN CONTAR
-- La planilla trae `0000` o la celda vacia en 10 filas ("o-rings varios",
-- "mangueras varias", "material electrico vario", "repuestos de chopera",
-- "repuestos de molino", "manometros y codos inox", "documentos", "quimicos de
-- limpieza", "acoples de manguera varios" y "acople de barril tipo G"). `0000`
-- no es cero: es una caja de surtido que nadie conto.
--
-- Cargarlos en 0 diria que no hay ninguno, que es falso. Entran con
-- `controla_stock = false`: quedan en el catalogo, con su ubicacion, pero sin
-- afirmar una cantidad que no sabemos. Al final del script esta el UPDATE para
-- pasarlos a stock controlado cuando se cuenten.
--
-- Los nombres se corrigieron uno por uno (la planilla dice "abrasadera",
-- "acoplerapido", "conetor", "valbula", "mangura"); el nombre original de cada
-- uno queda en `docs/CARGA-PLANILLAS-COVEN.md`.
--
-- Idempotente. Solo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $inv$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';
  r         record;
  v_cat     uuid;
  v_ubi     uuid;
  v_prod    uuid;
  v_nuevo   boolean;
  v_n       int;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Categorias
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('CONEX', 'Conexiones y accesorios'),
      ('REP', 'Repuestos y consumibles de planta'),
      ('VAR', 'Varios')
    ) AS t(codigo, nombre)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.categorias_productos
                    WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.nombre)) THEN
      INSERT INTO cerveceriaerp.categorias_productos (empresa_id, nombre, codigo, activo)
      VALUES (v_empresa, r.nombre, r.codigo, true);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. Ubicaciones fisicas
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('BOX 12-1'),
      ('BOX 2'),
      ('BOX 29-2'),
      ('BOX 29-3'),
      ('BOX 30-3'),
      ('BOX 30-4'),
      ('BOX 6-3'),
      ('KIT AZUL'),
      ('TUPPER 1'),
      ('TUPPER 2'),
      ('TUPPER 3'),
      ('TUPPER 4'),
      ('TUPPER ROJO 1')
    ) AS t(nombre)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.inventario_ubicaciones
                    WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.nombre)) THEN
      INSERT INTO cerveceriaerp.inventario_ubicaciones
        (empresa_id, nombre, tipo, descripcion, activo)
      VALUES (v_empresa, r.nombre, 'estante',
              'Ubicacion fisica de la planilla de inventario de planta.', true);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. Articulos
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('FAB-001', 'Abrazadera 3/4', 'Conexiones y accesorios', 'TUPPER 1', 7.0::numeric, true),
      ('FAB-002', 'Abrazadera 1', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-003', 'Abrazadera 1/2', 'Conexiones y accesorios', 'TUPPER 1', 7.0::numeric, true),
      ('FAB-004', 'Kit de analisis de agua', 'Repuestos y consumibles de planta', 'KIT AZUL', 1.0::numeric, true),
      ('FAB-005', 'Abrazadera omega 3/4', 'Conexiones y accesorios', 'TUPPER 1', 4.0::numeric, true),
      ('FAB-006', 'Abrazadera omega grande 1-1/2', 'Conexiones y accesorios', 'TUPPER 1', 5.0::numeric, true),
      ('FAB-007', 'Acople rapido JG gris 10 rosca 5/8', 'Conexiones y accesorios', 'TUPPER ROJO 1', 4.0::numeric, true),
      ('FAB-008', 'Acople rapido CMB rojo', 'Conexiones y accesorios', 'TUPPER ROJO 1', 4.0::numeric, true),
      ('FAB-009', 'Acople rapido CMB negro', 'Conexiones y accesorios', 'TUPPER ROJO 1', 5.0::numeric, true),
      ('FAB-010', 'Acople rapido CMB blanco', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-011', 'Conector rapido en T blanco', 'Conexiones y accesorios', 'TUPPER ROJO 1', 8.0::numeric, true),
      ('FAB-012', 'Conector rapido recto gris', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-013', 'Grifo picnic beer negro', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-014', 'Grifo plastico para cubo de embotellado', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-015', 'Union T plastica blanca para manguera', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-016', 'Abrazadera 2', 'Conexiones y accesorios', 'TUPPER 1', 1.0::numeric, true),
      ('FAB-017', 'Racor T 4/4/4', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-018', 'Racor T 6/6/6', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-019', 'Racor T 8/8/8', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-020', 'Racor T 10/10/10', 'Conexiones y accesorios', 'TUPPER ROJO 1', 7.0::numeric, true),
      ('FAB-021', 'Racor Y 12/12/12', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-022', 'Racor acople 12/12', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-023', 'Racor codo 10/10', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-024', 'Racor codo 10 rosca 1/4', 'Conexiones y accesorios', 'TUPPER ROJO 1', 3.0::numeric, true),
      ('FAB-025', 'Racor T 6/6 rosca 1/4', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-026', 'Racor acople 6/6', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-027', 'Racor acople 8/8', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-028', 'Racor recto 6 rosca 1/8', 'Conexiones y accesorios', 'TUPPER ROJO 1', 3.0::numeric, true),
      ('FAB-029', 'Racor recto 4 rosca 1/8', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-030', 'Racor recto 6 rosca 1/4', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-031', 'Racor recto 4 rosca 1/4', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-032', 'Racor recto 4 rosca 3/16', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-033', 'Racor curvo 4 rosca 3/16 con regulador', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-034', 'Llave plastica de fermentador', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-035', 'Valvula pequeña azul de plastico', 'Conexiones y accesorios', 'TUPPER ROJO 1', 1.0::numeric, true),
      ('FAB-036', 'Abrazadera omega 2', 'Conexiones y accesorios', 'TUPPER 1', 5.0::numeric, true),
      ('FAB-037', 'Racor curvo 10 rosca 1/4 con regulador', 'Conexiones y accesorios', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-038', 'Cola de chancho de cobre', 'Conexiones y accesorios', 'BOX 12-1', 1.0::numeric, true),
      ('FAB-039', 'Snap-lock 1/2 50B hembra', 'Conexiones y accesorios', 'BOX 12-1', 2.0::numeric, true),
      ('FAB-040', 'Snap-lock 1/2 50B macho', 'Conexiones y accesorios', 'BOX 12-1', 1.0::numeric, true),
      ('FAB-041', 'Snap-lock curvo 1/2 rosca 1/2', 'Conexiones y accesorios', 'BOX 12-1', 2.0::numeric, true),
      ('FAB-042', 'Llave de paso CF8M 1/2 inox', 'Conexiones y accesorios', 'BOX 12-1', 1.0::numeric, true),
      ('FAB-043', 'Acople de barril tipo C', 'Conexiones y accesorios', 'BOX 12-1', 1.0::numeric, true),
      ('FAB-044', 'Goma de carga de enlatadora, silicona', 'Repuestos y consumibles de planta', 'TUPPER ROJO 1', 2.0::numeric, true),
      ('FAB-045', 'O-rings varios', 'Repuestos y consumibles de planta', 'TUPPER 4', 0::numeric, false),
      ('FAB-046', 'Acoples de manguera varios', 'Conexiones y accesorios', 'TUPPER 2', 0::numeric, false),
      ('FAB-047', 'Junta clamp 1,5'''' silicona', 'Repuestos y consumibles de planta', 'TUPPER 4', 20.0::numeric, true),
      ('FAB-048', 'Junta clamp 4''''', 'Repuestos y consumibles de planta', 'TUPPER 4', 1.0::numeric, true),
      ('FAB-049', 'Junta clamp 2''''', 'Repuestos y consumibles de planta', 'TUPPER 4', 1.0::numeric, true),
      ('FAB-050', 'Mangueras varias', 'Repuestos y consumibles de planta', 'BOX 2', 0::numeric, false),
      ('FAB-051', 'Material electrico vario', 'Repuestos y consumibles de planta', 'BOX 29-3', 0::numeric, false),
      ('FAB-052', 'Repuestos de chopera', 'Repuestos y consumibles de planta', 'TUPPER 3', 0::numeric, false),
      ('FAB-053', 'Repuestos de molino', 'Repuestos y consumibles de planta', 'BOX 6-3', 0::numeric, false),
      ('FAB-054', 'Manometros y codos inox', 'Repuestos y consumibles de planta', 'BOX 30-4', 0::numeric, false),
      ('FAB-055', 'Documentos', 'Varios', 'BOX 29-2', 0::numeric, false),
      ('FAB-056', 'Quimicos de limpieza', 'Repuestos y consumibles de planta', 'BOX 30-3', 0::numeric, false),
      ('FAB-057', 'Acople de barril tipo G', 'Conexiones y accesorios', 'BOX 12-1', 0::numeric, false)
    ) AS t(sku, nombre, categoria, ubicacion, cantidad, contado)
  LOOP
    SELECT id INTO v_cat FROM cerveceriaerp.categorias_productos
     WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.categoria);
    SELECT id INTO v_ubi FROM cerveceriaerp.inventario_ubicaciones
     WHERE empresa_id = v_empresa AND upper(nombre) = upper(r.ubicacion);

    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    v_nuevo := v_prod IS NULL;

    IF v_nuevo THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock, es_insumo, es_vendible,
         categoria_principal_id, ubicacion_principal_id)
      VALUES
        (v_empresa, v_sucursal, r.nombre, r.sku, 'UNIDAD', 0,
         0, CASE WHEN r.contado THEN r.cantidad ELSE 0 END,
         true, r.contado, false, false, v_cat, v_ubi)
      RETURNING id INTO v_prod;

      -- El stock que entra tiene que poder explicarse desde el kardex.
      IF r.contado AND r.cantidad > 0 THEN
        INSERT INTO cerveceriaerp.movimientos_inventario
          (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia)
        VALUES
          (v_empresa, v_sucursal, v_prod, r.nombre, r.sku,
           'ENTRADA', r.cantidad, 0, 'inventario_inicial',
           'Planilla inventario de planta');
      END IF;
    ELSE
      -- Ya existia: se refrescan categoria y ubicacion, pero NO el stock. El
      -- stock lo mueve el ERP; volver a correr el script no puede duplicarlo.
      UPDATE cerveceriaerp.productos
         SET nombre = r.nombre,
             categoria_principal_id = coalesce(categoria_principal_id, v_cat),
             ubicacion_principal_id = coalesce(ubicacion_principal_id, v_ubi),
             updated_at = now()
       WHERE id = v_prod;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sku LIKE 'FAB-%';
  RAISE NOTICE 'Inventario de planta: % articulos.', v_n;
  RAISE NOTICE '10 quedan sin control de stock hasta que se cuenten.';
END
$inv$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
SELECT u.nombre AS ubicacion, count(*) AS articulos,
       sum(p.stock_actual) AS unidades,
       count(*) FILTER (WHERE NOT p.controla_stock) AS sin_contar
  FROM cerveceriaerp.productos p
  JOIN cerveceriaerp.inventario_ubicaciones u ON u.id = p.ubicacion_principal_id
 WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND p.sku LIKE 'FAB-%'
 GROUP BY u.nombre ORDER BY u.nombre;
-- Esperado: 13 ubicaciones, 57 articulos, 10 sin contar.

SELECT sku, nombre FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND sku LIKE 'FAB-%' AND NOT controla_stock
 ORDER BY sku;

-- ---------------------------------------------------------------------------
-- Para despues: cuando se cuente una caja de surtido
-- ---------------------------------------------------------------------------
-- UPDATE cerveceriaerp.productos SET controla_stock = true, stock_actual = <contado>
--  WHERE sku = 'FAB-0nn';
-- y cargar el movimiento desde Inventario para que el kardex lo explique.
