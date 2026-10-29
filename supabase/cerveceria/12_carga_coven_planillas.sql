-- =============================================================================
-- 12. Carga de las planillas de COVEN: insumos, proveedores, recetas y lotes
-- =============================================================================
--
-- DE DONDE SALE
-- De cuatro planillas: `coccion-grande` (3 lotes de 500 L), `coccion-pequena`
-- (12 lotes piloto), `coven_costeo_500l_y_precios` y `inventario-fabrica`.
-- Este script carga las dos de coccion; el inventario de planta y el modelo de
-- costeo van aparte.
--
-- QUE DEJA
--   · 2 proveedores (Mercado Craft, Cerveshopp)
--   · 23 insumos con su costo por unidad base
--   · 4 productos a granel (uno por estilo)
--   · 4 recetas
--   · 15 lotes historicos cerrados, con su consumo y su costo
--
-- LO QUE ESTE SCRIPT **NO** HACE, A PROPOSITO
--
--   · NO mueve stock. Los 15 lotes ya se produjeron y sus insumos ya se
--     consumieron en su momento. Si el script generara movimientos de
--     inventario, descontaria de nuevo una malta que no esta en el deposito y
--     dejaria el stock en negativo. Los lotes entran como historia cerrada.
--   · NO toca `costo_promedio` de un insumo que ya tenga costo. El costo real
--     lo calcula el ERP con las compras (CPP); el numero de la planilla es
--     solo el punto de partida para los insumos que todavia no tienen ninguna
--     compra cargada.
--   · NO inventa el rendimiento de los cocimientos chicos. Las planillas no
--     dicen cuantos litros sale cada lote piloto, asi que esas tres recetas
--     quedan INACTIVAS: una receta sin rendimiento real costea cualquier cosa.
--     Al final del script esta el UPDATE para activarlas.
--
-- Idempotente: se puede correr mas de una vez.
-- Solo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $carga$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';
  r          record;
  v_prod     uuid;
  v_granel   uuid;
  v_receta   uuid;
  v_lote     uuid;
  v_n        int;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Proveedores
  -- ---------------------------------------------------------------------------
  -- Sin RUC: las planillas no lo traen. Hay que completarlo antes de poder
  -- cargarles una compra o una factura.
  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.proveedores
                  WHERE empresa_id = v_empresa AND upper(nombre) = upper('Mercado Craft')) THEN
    INSERT INTO cerveceriaerp.proveedores (empresa_id, nombre, estado, observaciones)
    VALUES (v_empresa, 'Mercado Craft', 'activo', 'Proveedor de los lotes de 500 L (planilla coccion-grande). Falta el RUC.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.proveedores
                  WHERE empresa_id = v_empresa AND upper(nombre) = upper('Cerveshopp')) THEN
    INSERT INTO cerveceriaerp.proveedores (empresa_id, nombre, estado, observaciones)
    VALUES (v_empresa, 'Cerveshopp', 'activo', 'Proveedor de los lotes piloto (planilla coccion-pequena). Falta el RUC.');
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Insumos
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('MP-PILSEN', 'Malta Pilsen UMA', 'KG', 8600::numeric, 'grande: 8.600 Gs/kg (lotes 1-3)'),
      ('MP-VIENNA', 'Malta Vienna UMA', 'KG', 11000::numeric, 'grande: 11.000 Gs/kg (lote 2, el mas reciente)'),
      ('MP-CARACLAIR', 'Malta Cara Clair', 'KG', 22300::numeric, 'grande: 22.300 Gs/kg (lotes 1 y 2)'),
      ('MP-MELANOID', 'Malta Melanoidina UMA', 'KG', 11000::numeric, 'grande: 11.000 Gs/kg (lote 3)'),
      ('MP-CARA30', 'Malta Cara 30 UMA', 'KG', 11000::numeric, 'grande: 11.000 Gs/kg (lote 3)'),
      ('MP-MUNICH', 'Malta Munich', 'KG', 16000::numeric, 'pequena: 4.000 Gs / 250 g'),
      ('MP-CARAPILS', 'Malta Carapils', 'KG', 16000::numeric, 'pequena: 4.000 Gs / 250 g'),
      ('MP-CARAMEL20', 'Malta Caramelo 20', 'KG', 20000::numeric, 'pequena: 5.000 Gs / 250 g'),
      ('MP-CARAMEL60', 'Malta Caramelo 60', 'KG', 20000::numeric, 'pequena: 15.000 Gs / 750 g (lote 4)'),
      ('MP-PALEALE', 'Malta Pale Ale', 'KG', 14000::numeric, 'pequena: 84.000 Gs / 6 kg (lote 4)'),
      ('LU-CASCADE', 'Lupulo Cascade', 'G', 508::numeric, 'grande: 101.600 Gs / pack 200 g'),
      ('LU-HALLER', 'Lupulo Hallertau Tradition', 'G', 484::numeric, 'grande: 242.000 Gs / pack 500 g'),
      ('LU-MAGNUM', 'Lupulo Magnum', 'G', 505::numeric, 'grande: 101.000 Gs / pack 200 g'),
      ('LU-CENTENNIAL', 'Lupulo Centennial', 'G', 508::numeric, 'grande: 101.600 Gs / pack 200 g'),
      ('LU-AMARILLO', 'Lupulo Amarillo', 'G', 608::numeric, 'grande: 121.600 Gs / pack 200 g'),
      ('LU-CITRACRYO', 'Lupulo Citra Cryo', 'G', 445::numeric, 'grande: 445.000 Gs / ''pack 1 litro'' -- REVISAR, ver notas'),
      ('LU-EKG', 'Lupulo East Kent Golding', 'G', 1000::numeric, 'pequena: 15.000 Gs / 15 g'),
      ('LV-US05', 'Levadura Safale US-05', 'G', 1422::numeric, 'grande: 711.000 Gs / pack 500 g'),
      ('LV-NEWE', 'Levadura New England', 'G', 0::numeric, 'grande: 699.000 Gs / ''11 g'' -- REVISAR, ver notas'),
      ('CL-IRISH', 'Irish Moss (clarificante)', 'G', 500::numeric, 'grande: 500 Gs/g (lotes 1-3)'),
      ('CL-WHIRLFLOC', 'Whirlfloc', 'UNIDAD', 4000::numeric, 'pequena: 4.000 Gs la pastilla'),
      ('ES-NARANJA', 'Cascara de naranja', 'G', 200::numeric, 'pequena: 5.000 Gs / 25 g (lote 8)'),
      ('ES-CEDRON', 'Cedron Kapi''i', 'G', 400::numeric, 'pequena: 2.000 Gs / 5 g (lote 8, el mas reciente)')
    ) AS t(sku, nombre, unidad, costo, origen)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;

    IF v_prod IS NULL THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock, es_insumo, es_vendible)
      VALUES
        (v_empresa, v_sucursal, r.nombre, r.sku, r.unidad, r.costo,
         0, 0, true, true, true, false);
    ELSE
      -- Marcarlo como insumo si venia de otro script, pero NO pisar un costo
      -- real: si ya hubo compras, el CPP del ERP manda sobre la planilla.
      UPDATE cerveceriaerp.productos
         SET es_insumo = true,
             es_vendible = false,
             costo_promedio = CASE WHEN coalesce(costo_promedio, 0) = 0
                                   THEN r.costo ELSE costo_promedio END,
             updated_at = now()
       WHERE id = v_prod;
    END IF;
  END LOOP;

  -- Lo que una receta consume es un insumo, lo haya creado este script o no:
  -- los de la receta que cargo el script 07 venian sin la marca.
  UPDATE cerveceriaerp.productos p
     SET es_insumo = true, updated_at = now()
   WHERE p.empresa_id = v_empresa
     AND p.es_insumo IS NOT TRUE
     AND EXISTS (SELECT 1 FROM cerveceriaerp.receta_items i WHERE i.insumo_producto_id = p.id);

  -- ---------------------------------------------------------------------------
  -- 3. Producto a granel por estilo (el producto en proceso, en litros)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('CV-BL-GRANEL', 'Coven Blonde Ale (granel)'),
      ('CV-SE-GRANEL', 'Coven Session IPA (granel)'),
      ('CV-BLL-GRANEL', 'Coven Blonde Ale Ligera (granel)'),
      ('CV-AM-GRANEL', 'Coven Amber Ale Suave (granel)'),
      ('CV-BL-GRANEL-P', 'Coven Blonde Ale piloto (granel)'),
      ('CV-SE-GRANEL-P', 'Coven Session IPA piloto (granel)')
    ) AS t(sku, nombre)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.productos
                    WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku) THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock, es_insumo, es_vendible)
      VALUES
        (v_empresa, v_sucursal, r.nombre, r.sku, 'L', 0, 0, 0, true, true, false, false);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 4. Recetas
  -- ---------------------------------------------------------------------------

  -- Coven Session IPA 500 L — coccion-grande, lote 2 del 27/08/2026
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'CV-SE-GRANEL';
  v_receta := 'a1b0c3d4-0001-4a00-9000-000000000001'::uuid;

  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = 'Coven Session IPA 500 L', producto_id = v_granel,
           rendimiento_cantidad = 500, rendimiento_unidad = 'L',
           notas = 'Derivada de coccion-grande, lote 2 del 27/08/2026.',
           activa = true, updated_at = now()
     WHERE id = v_receta;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, notas, activa)
    VALUES
      (v_receta, v_empresa, v_sucursal, v_granel, 'Coven Session IPA 500 L',
       500, 'L', 'Derivada de coccion-grande, lote 2 del 27/08/2026.',
       true);
  END IF;

  DELETE FROM cerveceriaerp.receta_items WHERE receta_id = v_receta;
  FOR r IN
    SELECT * FROM (VALUES
      ('MP-PILSEN', 82.5::numeric, 'KG', 1),
      ('MP-VIENNA', 14.1::numeric, 'KG', 2),
      ('MP-CARACLAIR', 7.4::numeric, 'KG', 3),
      ('LU-MAGNUM', 250::numeric, 'G', 4),
      ('LU-CENTENNIAL', 250::numeric, 'G', 5),
      ('LU-AMARILLO', 400::numeric, 'G', 6),
      ('LU-CITRACRYO', 2000::numeric, 'G', 7),
      ('LV-NEWE', 11::numeric, 'G', 8),
      ('CL-IRISH', 50::numeric, 'G', 9)
    ) AS t(sku, cantidad, unidad, orden)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    INSERT INTO cerveceriaerp.receta_items
      (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
    VALUES (v_receta, v_empresa, v_prod, r.cantidad, r.unidad, 0, r.orden);
  END LOOP;

  -- Coven Blonde Ale Ligera (piloto) — coccion-pequena, lotes 6, 7, 9, 10, 11, 12 y 13 (identicos entre si)
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'CV-BLL-GRANEL';
  v_receta := 'a1b0c3d4-0002-4a00-9000-000000000002'::uuid;

  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = 'Coven Blonde Ale Ligera (piloto)', producto_id = v_granel,
           rendimiento_cantidad = 1, rendimiento_unidad = 'L',
           notas = 'Derivada de coccion-pequena, lotes 6, 7, 9, 10, 11, 12 y 13 (identicos entre si).',
           activa = false, updated_at = now()
     WHERE id = v_receta;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, notas, activa)
    VALUES
      (v_receta, v_empresa, v_sucursal, v_granel, 'Coven Blonde Ale Ligera (piloto)',
       1, 'L', 'Derivada de coccion-pequena, lotes 6, 7, 9, 10, 11, 12 y 13 (identicos entre si).',
       false);
  END IF;

  DELETE FROM cerveceriaerp.receta_items WHERE receta_id = v_receta;
  FOR r IN
    SELECT * FROM (VALUES
      ('MP-PILSEN', 6.5::numeric, 'KG', 1),
      ('MP-MUNICH', 0.25::numeric, 'KG', 2),
      ('MP-CARAPILS', 0.25::numeric, 'KG', 3),
      ('MP-CARAMEL20', 0.25::numeric, 'KG', 4),
      ('LU-CASCADE', 25::numeric, 'G', 5),
      ('LU-EKG', 15::numeric, 'G', 6),
      ('LV-US05', 23::numeric, 'G', 7),
      ('CL-WHIRLFLOC', 1::numeric, 'UNIDAD', 8)
    ) AS t(sku, cantidad, unidad, orden)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    INSERT INTO cerveceriaerp.receta_items
      (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
    VALUES (v_receta, v_empresa, v_prod, r.cantidad, r.unidad, 0, r.orden);
  END LOOP;

  -- Coven Blonde Ale (piloto) — coccion-pequena, lote 3 del 03/12/2025 (el lote 5 repite la misma carga)
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'CV-BL-GRANEL-P';
  v_receta := 'a1b0c3d4-0003-4a00-9000-000000000003'::uuid;

  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = 'Coven Blonde Ale (piloto)', producto_id = v_granel,
           rendimiento_cantidad = 1, rendimiento_unidad = 'L',
           notas = 'Derivada de coccion-pequena, lote 3 del 03/12/2025 (el lote 5 repite la misma carga).',
           activa = false, updated_at = now()
     WHERE id = v_receta;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, notas, activa)
    VALUES
      (v_receta, v_empresa, v_sucursal, v_granel, 'Coven Blonde Ale (piloto)',
       1, 'L', 'Derivada de coccion-pequena, lote 3 del 03/12/2025 (el lote 5 repite la misma carga).',
       false);
  END IF;

  DELETE FROM cerveceriaerp.receta_items WHERE receta_id = v_receta;
  FOR r IN
    SELECT * FROM (VALUES
      ('MP-PILSEN', 6.5::numeric, 'KG', 1),
      ('MP-MUNICH', 0.25::numeric, 'KG', 2),
      ('MP-VIENNA', 0.25::numeric, 'KG', 3),
      ('MP-CARAPILS', 0.25::numeric, 'KG', 4),
      ('MP-CARAMEL20', 0.25::numeric, 'KG', 5),
      ('LU-CASCADE', 25::numeric, 'G', 6),
      ('LU-EKG', 15::numeric, 'G', 7),
      ('LV-US05', 23::numeric, 'G', 8),
      ('CL-WHIRLFLOC', 1::numeric, 'UNIDAD', 9)
    ) AS t(sku, cantidad, unidad, orden)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    INSERT INTO cerveceriaerp.receta_items
      (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
    VALUES (v_receta, v_empresa, v_prod, r.cantidad, r.unidad, 0, r.orden);
  END LOOP;

  -- Coven Session IPA (piloto) — coccion-pequena, lote 8 del 08/01/2026
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'CV-SE-GRANEL-P';
  v_receta := 'a1b0c3d4-0004-4a00-9000-000000000004'::uuid;

  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = 'Coven Session IPA (piloto)', producto_id = v_granel,
           rendimiento_cantidad = 1, rendimiento_unidad = 'L',
           notas = 'Derivada de coccion-pequena, lote 8 del 08/01/2026.',
           activa = false, updated_at = now()
     WHERE id = v_receta;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, notas, activa)
    VALUES
      (v_receta, v_empresa, v_sucursal, v_granel, 'Coven Session IPA (piloto)',
       1, 'L', 'Derivada de coccion-pequena, lote 8 del 08/01/2026.',
       false);
  END IF;

  DELETE FROM cerveceriaerp.receta_items WHERE receta_id = v_receta;
  FOR r IN
    SELECT * FROM (VALUES
      ('MP-PILSEN', 5.4::numeric, 'KG', 1),
      ('MP-VIENNA', 0.9::numeric, 'KG', 2),
      ('MP-CARAPILS', 0.45::numeric, 'KG', 3),
      ('LU-MAGNUM', 10::numeric, 'G', 4),
      ('LU-CASCADE', 45::numeric, 'G', 5),
      ('LU-AMARILLO', 50::numeric, 'G', 6),
      ('ES-NARANJA', 25::numeric, 'G', 7),
      ('ES-CEDRON', 20::numeric, 'G', 8),
      ('LV-US05', 23::numeric, 'G', 9),
      ('CL-WHIRLFLOC', 1::numeric, 'UNIDAD', 10)
    ) AS t(sku, cantidad, unidad, orden)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    INSERT INTO cerveceriaerp.receta_items
      (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
    VALUES (v_receta, v_empresa, v_prod, r.cantidad, r.unidad, 0, r.orden);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 5. Lotes historicos
  -- ---------------------------------------------------------------------------
  -- Entran CERRADOS y sin fermentador: ya pasaron. Sin fermentador tampoco
  -- chocan con el indice que impide dos lotes activos en el mismo tanque.
  -- El consumo y el costo de insumos quedan en `observaciones` porque las
  -- planillas piloto no dicen cuantos litros rindio cada cocimiento, y sin
  -- volumen no se puede armar una produccion costeada por litro.
  FOR r IN
    SELECT * FROM (VALUES
      ('COC-G-01', 'CV-BL-GRANEL', '2026-08-23'::date, 500, 'Cargado de la planilla de coccion. Estilo Blonde Ale. Proveedor mercado craf. Costo de insumos 2,244,729 Gs (no incluye mano de obra ni energia). Consumo: PILSEN UMA 103.33 x 8,600 · VIENNA UMA 5 x 11,000 · CARACLAIR 4.17 x 22,300 · CASCADE 200G 2 x 101,600 · US-05 500G 1 x 711,000 · CASCADE 50G 1 x 26,900 · TRADITION 500GR 1 x 242,000 · CLARIFICANTE 50 x 500.'),
      ('COC-G-02', 'CV-SE-GRANEL', '2026-08-27'::date, 500, 'Cargado de la planilla de coccion. Estilo Session IPA. Proveedor mercado craf. Costo de insumos 3,143,320 Gs (no incluye mano de obra ni energia). Consumo: PILSEN UMA 82.5 x 8,600 · VIENNA UMA 14.1 x 11,000 · CLARA CLAIR 7.4 x 22,300 · MAGNUM 200GR 1 x 101,000 · MAGNUM 50GR 1 x 27,000 · CENTENIAL 200GR 1 x 101,600 · CENTENIAL 50GR 1 x 26,900 · AMARILLO 200GR 2 x 121,600 · CITRA CRYO 1 LITRO 2 x 445,000 · NEW E 11GR 1 x 699,000 · CLARIFICANTE 50 x 500.'),
      ('COC-G-03', 'CV-BL-GRANEL', '2026-08-09'::date, 500, 'Cargado de la planilla de coccion. Estilo Blonde Ale. Proveedor mercado craf. Costo de insumos 1,675,104 Gs (no incluye mano de obra ni energia). Consumo: PILSEN UMA 42.84 x 8,600 · VIENNA UMA 10.88 x 10,000 · MALTA MLANOIDINA UMA 10.2 x 11,000 · MALTA CARA 30 UMA 4.08 x 11,000 · CENTENIAL 200GR 3 x 101,600 · SAFALE USA 05 500G 1 x 711,000 · CLARIFICANTE 50 x 500.'),
      ('COC-P-02', 'CV-BL-GRANEL-P', '2025-11-27'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale. Proveedor CERVESHOPP. Costo de insumos 211,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 7.5kg = 97,500 · MUNICH 300g = 4,500 · VIENNA 300g = 4,500 · CARAPILS 300g = 4,500 · CARAMELO 20 300g = 6,000 · CASCADE 30g = 15,000 · E.K. GOLDING 15g = 15,000 · US-05 2un = 60,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-03', 'CV-BL-GRANEL-P', '2025-12-03'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale. Proveedor CERVESHOPP. Costo de insumos 203,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · VIENNA 250g = 4,000 · CARAPILS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 25g = 12,500 · E.K. GOLDING 15g = 15,000 · US-05 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-04', 'CV-BLL-GRANEL', '2025-12-03'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 215,500 Gs (no incluye mano de obra ni energia). Consumo: PALE ALE 6kg = 84,000 · MUNICH 750g = 11,500 · CARAMELO 60 750g = 15,000 · CASCADE 30g = 15,000 · CASCADE 20g = 10,000 · CASCADE 20g = 10,000 · US-05 2un = 70,000.'),
      ('COC-P-05', 'CV-AM-GRANEL', '2025-12-17'::date, NULL, 'Cargado de la planilla de coccion. Estilo Amber Ale Suave. Proveedor CERVESHOPP. Costo de insumos 203,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · VIENNA 250g = 4,000 · CARAPILS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 25g = 12,500 · E.K. GOLDING 15g = 15,000 · US-05 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-06', 'CV-BLL-GRANEL', '2026-01-07'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-07', 'CV-BLL-GRANEL', '2026-02-27'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-08', 'CV-SE-GRANEL-P', '2026-01-08'::date, NULL, 'Cargado de la planilla de coccion. Estilo Session IPA. Proveedor CERVESHOPP. Costo de insumos 262,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 5.4kg = 70,500 · VIENNA 900g = 13,500 · CARAPLIS 450g = 7,000 · MAGNUM 10g = 10,000 · CASCADE 25g = 15,000 · AMARILLO 30g = 30,000 · CASCAD20G+AMARI20G 20g = 32,000 · CASCARA DE NARANJA 25g = 5,000 · CEDRON KAPII 15g = 3,000 · CEDRON KAPII 5g = 2,000 · US-05 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-09', 'CV-BLL-GRANEL', '2026-02-27'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-10', 'CV-BLL-GRANEL', '2026-04-10'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-11', 'CV-BLL-GRANEL', '2026-04-10'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-12', 'CV-BLL-GRANEL', '2026-04-26'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.'),
      ('COC-P-13', 'CV-BLL-GRANEL', '2026-04-26'::date, NULL, 'Cargado de la planilla de coccion. Estilo Blonde Ale Ligera. Proveedor CERVESHOPP. Costo de insumos 199,000 Gs (no incluye mano de obra ni energia). Consumo: PILSEN 6.5kg = 84,500 · MUNICH 250g = 4,000 · CARAPLIS 250g = 4,000 · CARAMELO 20 250g = 5,000 · CASCADE 7,1% 25g = 12,500 · EKG 5,7% 15g = 15,000 · us-05 1,5 2un = 70,000 · WHIRLFLOC 1un = 4,000.')
    ) AS t(codigo, sku_granel, fecha, volumen, observaciones)
  LOOP
    SELECT id INTO v_granel FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku_granel;

    SELECT id INTO v_lote FROM cerveceriaerp.produccion_lotes
     WHERE empresa_id = v_empresa AND codigo = r.codigo;

    IF v_lote IS NULL THEN
      INSERT INTO cerveceriaerp.produccion_lotes
        (empresa_id, sucursal_id, codigo, producto_granel_id, estado,
         volumen_planificado, fecha_inicio, observaciones)
      VALUES
        (v_empresa, v_sucursal, r.codigo, v_granel, 'cerrado',
         r.volumen, r.fecha::timestamptz, r.observaciones)
      RETURNING id INTO v_lote;

      INSERT INTO cerveceriaerp.produccion_lote_etapas (lote_id, empresa_id, etapa, fecha, nota)
      VALUES (v_lote, v_empresa, 'cerrado', r.fecha::timestamptz,
              'Lote historico importado de la planilla de coccion.');
    ELSE
      UPDATE cerveceriaerp.produccion_lotes
         SET producto_granel_id = v_granel, volumen_planificado = r.volumen,
             fecha_inicio = r.fecha::timestamptz, observaciones = r.observaciones,
             updated_at = now()
       WHERE id = v_lote;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM cerveceriaerp.produccion_lotes WHERE empresa_id = v_empresa;
  RAISE NOTICE 'Carga lista. Lotes en el sistema: %.', v_n;
  RAISE NOTICE 'Las 3 recetas piloto quedan INACTIVAS hasta cargarles el rendimiento real.';
END
$carga$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
SELECT 'proveedores' AS que, count(*) FROM cerveceriaerp.proveedores
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
UNION ALL SELECT 'insumos', count(*) FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND es_insumo
UNION ALL SELECT 'recetas', count(*) FROM cerveceriaerp.recetas
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
UNION ALL SELECT 'lotes', count(*) FROM cerveceriaerp.produccion_lotes
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb';
-- Esperado: proveedores >= 2 · insumos >= 23 · recetas >= 5 · lotes 15

-- Costeo de la unica receta con rendimiento real (Session IPA 500 L):
SELECT i.orden, p.nombre AS insumo, i.cantidad, i.unidad_medida,
       p.costo_promedio, round(i.cantidad * p.costo_promedio) AS subcosto
  FROM cerveceriaerp.receta_items i
  JOIN cerveceriaerp.productos p ON p.id = i.insumo_producto_id
 WHERE i.receta_id = 'a1b0c3d4-0001-4a00-9000-000000000001'
 ORDER BY i.orden;

-- ---------------------------------------------------------------------------
-- Para despues: activar las recetas piloto cargandoles el rendimiento real
-- ---------------------------------------------------------------------------
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = 'a1b0c3d4-0002-4a00-9000-000000000002';  -- Blonde Ale Ligera (piloto)
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = 'a1b0c3d4-0003-4a00-9000-000000000003';  -- Blonde Ale (piloto)
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = 'a1b0c3d4-0004-4a00-9000-000000000004';  -- Session IPA (piloto)
