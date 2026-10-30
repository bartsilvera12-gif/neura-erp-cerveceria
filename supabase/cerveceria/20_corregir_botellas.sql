-- =============================================================================
-- 20. Corrección: las botellas no se crearon y el mínimo cayó en otro producto
-- =============================================================================
--
-- QUE PASO
-- El script 18 buscaba cada insumo por nombre antes de crearlo, para no
-- duplicar lo que ya estuviera cargado. Para las botellas buscaba
-- '%botella%' — y "Grifo plástico para cubo de embotellado" (FAB-014, de la
-- planilla de planta) contiene "botella". Así que el script creyó que las
-- botellas ya existían: le puso el mínimo de 50 al grifo y no creó el insumo.
--
-- Por eso la verificación devuelve 7 filas en vez de 8.
--
-- QUE HACE ESTE SCRIPT
--   1. Le saca al grifo el mínimo y la marca de insumo que no le corresponden.
--   2. Crea "Botellas" como corresponde, con mínimo 50.
--
-- El 18 ya quedó corregido en el repositorio (ahora ancla la búsqueda al
-- principio de palabra), así que volver a correrlo no repite el problema.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $fix$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';  -- Cervecería
  v_cat      uuid;
  v_prod     uuid;
  v_grifo    integer;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Devolver el grifo a como estaba
  -- ---------------------------------------------------------------------------
  -- Sólo si quedó con el mínimo que le puso el 18: si alguien ya le cargó un
  -- mínimo propio a mano, este script no se lo pisa.
  UPDATE cerveceriaerp.productos
     SET stock_minimo = 0,
         es_insumo = false,
         updated_at = now()
   WHERE empresa_id = v_empresa
     AND sucursal_id = v_sucursal
     AND sku = 'FAB-014'
     AND stock_minimo = 50;
  GET DIAGNOSTICS v_grifo = ROW_COUNT;
  IF v_grifo > 0 THEN
    RAISE NOTICE 'FAB-014 (grifo de embotellado): minimo y marca de insumo revertidos.';
  ELSE
    RAISE NOTICE 'FAB-014 no tenia el minimo de 50: no se toco.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Crear las botellas
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_cat FROM cerveceriaerp.categorias_productos
   WHERE empresa_id = v_empresa AND upper(nombre) = upper('Insumos críticos de planta');

  SELECT id INTO v_prod FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'INS-BOTELLA';

  IF v_prod IS NULL THEN
    -- Igual que los otros siete: nace en 0 y sin control de stock, así no
    -- figura como crítico hasta que alguien las cuente.
    INSERT INTO cerveceriaerp.productos
      (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
       precio_venta, stock_actual, stock_minimo, activo, controla_stock,
       es_insumo, es_vendible, categoria_principal_id)
    VALUES
      (v_empresa, v_sucursal, 'Botellas', 'INS-BOTELLA', 'UNIDAD', 0,
       0, 0, 50, true, false,
       true, false, v_cat);
    RAISE NOTICE 'Creado INS-BOTELLA con minimo 50.';
  ELSE
    UPDATE cerveceriaerp.productos
       SET stock_minimo = 50, es_insumo = true, updated_at = now()
     WHERE id = v_prod;
    RAISE NOTICE 'INS-BOTELLA ya existia: minimo actualizado a 50.';
  END IF;
END
$fix$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT sku, nombre, unidad_medida, stock_minimo, stock_actual, controla_stock
  FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND (sku LIKE 'INS-%' OR sku = 'FAB-047')
 ORDER BY sku;
-- Esperado: 8 filas, con INS-BOTELLA entre ellas.

SELECT sku, nombre, stock_minimo, es_insumo
  FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND sku = 'FAB-014';
-- Esperado: minimo 0 y es_insumo false. Es un repuesto, no un insumo crítico.
