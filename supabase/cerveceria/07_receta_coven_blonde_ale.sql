-- =============================================================================
-- 07 — Receta COVEN Blonde Ale 500 L
-- =============================================================================
-- Corre DESPUÉS de `06_recetas_precio_y_formatos.sql`.
--
-- Carga la receta maestra COVEN-BL-500-V0.9: insumos, cantidades y formatos de
-- venta. Todo va a la sucursal CERVECERIA.
--
-- LO QUE ESTE SCRIPT **NO** PUEDE SABER, y hay que cargar a mano después:
--
--   · COSTO de cada insumo. Los productos se crean con costo 0, y el costo
--     promedio se llena solo con la primera compra registrada. Hasta entonces
--     el costeo de la receta da 0 y el precio sugerido no sirve.
--   · PRECIO de los formatos. Se cargan en 0: el precio sale del costo real
--     una vez que haya compras, con el margen objetivo de cada formato.
--   · MERMA DE PROCESO real. Se carga 6 % como punto de partida; el documento
--     pide medirla en el primer lote (sección 16) y ajustarla.
--
-- Las cantidades son las del TOTAL de 500 L (los dos cocimientos juntos), no
-- las de un cocimiento. Hallertau va con los 500 g del cronograma de hervor;
-- el documento marca que si se confirma que eran 20 g/30 L hay que bajarlo a
-- ≈333 g.
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $receta$
DECLARE
  v_empresa    CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal   CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';  -- Cervecería
  v_receta_id  CONSTANT uuid := '0e117500-911b-4ead-b909-544c9e7fff3b';

  -- Insumos: sku, nombre, unidad de control de stock
  v_insumos CONSTANT jsonb := '[
    {"sku":"MP-PILSEN",  "nombre":"Malta Pilsen UMA",           "unidad":"KG"},
    {"sku":"MP-VIENNA",  "nombre":"Malta Vienna UMA",           "unidad":"KG"},
    {"sku":"MP-CARADEX", "nombre":"Malta Caradextrina UMA",     "unidad":"KG"},
    {"sku":"LU-CASCADE", "nombre":"Lúpulo Cascade",             "unidad":"G"},
    {"sku":"LU-HALLER",  "nombre":"Lúpulo Hallertau Tradition", "unidad":"G"},
    {"sku":"CL-IRISH",   "nombre":"Irish Moss",                 "unidad":"G"},
    {"sku":"LV-AY4",     "nombre":"Levadura Fermoale AY4",      "unidad":"G"}
  ]'::jsonb;

  -- Cantidades para el lote completo de 500 L (sección 02 del documento)
  v_items CONSTANT jsonb := '[
    {"sku":"MP-PILSEN",  "cantidad":103.33, "unidad":"KG", "orden":1},
    {"sku":"MP-VIENNA",  "cantidad":5.00,   "unidad":"KG", "orden":2},
    {"sku":"MP-CARADEX", "cantidad":4.17,   "unidad":"KG", "orden":3},
    {"sku":"LU-CASCADE", "cantidad":417,    "unidad":"G",  "orden":4},
    {"sku":"LU-HALLER",  "cantidad":500,    "unidad":"G",  "orden":5},
    {"sku":"CL-IRISH",   "cantidad":50,     "unidad":"G",  "orden":6},
    {"sku":"LV-AY4",     "cantidad":400,    "unidad":"G",  "orden":7}
  ]'::jsonb;

  -- Formatos de venta. Ajustar a los que realmente usen.
  v_formatos CONSTANT jsonb := '[
    {"sku":"CV-BL-B30", "nombre":"Coven Blonde Ale · Barril 30 L",   "capacidad":30,  "unidad":"L",  "margen":0.45, "orden":1},
    {"sku":"CV-BL-B20", "nombre":"Coven Blonde Ale · Barril 20 L",   "capacidad":20,  "unidad":"L",  "margen":0.45, "orden":2},
    {"sku":"CV-BL-500", "nombre":"Coven Blonde Ale · Botella 500 ml","capacidad":500, "unidad":"ML", "margen":0.55, "orden":3}
  ]'::jsonb;

  v_notas CONSTANT text :=
    E'COVEN-BL-500-V0.9 · Blonde Ale 500 L · 2 cocimientos × 250 L\n' ||
    E'RIMS + intercambiador de placas + fermentador isobárico\n\n' ||
    E'OBJETIVOS: OG 1,044–1,046 · FG 1,008–1,010 · ABV 4,6–4,9 % · IBU 17–19\n' ||
    E'Fermentación 18 °C → 20 °C · Maduración 2–4 °C, 5–7 días · 2,3–2,5 vol CO₂\n\n' ||
    E'MACERACIÓN: ~183 L de agua por cocimiento (~3,26 L/kg). Strike ~71 °C para\n' ||
    E'quedar en 64–65 °C. 60 min a 64,5 °C. pH 5,2–5,4 a los 10–15 min.\n' ||
    E'Mash out 75 °C por 10 min. Nunca energizar el RIMS sin circulación.\n\n' ||
    E'LAVADO: 133–142 L a 74–76 °C. Recolectar 308–317 L prehervor.\n\n' ||
    E'HERVOR 60 min: Cascade al inicio (≈208–210 g/coc.) · Irish Moss a 15 min\n' ||
    E'(25 g/coc.) · Hallertau a 5 min (250 g/coc.).\n\n' ||
    E'WHIRLPOOL y knockout a 18 °C (rango 17–19 °C). Oxigenar 8–10 ppm.\n' ||
    E'Inocular la levadura COMPLETA en el cocimiento 1; no reinocular en el 2.\n\n' ||
    E'IBU: el objetivo son 17–19 IBU, no una cantidad fija de gramos. Registrar\n' ||
    E'el AA% de cada lote de lúpulo y ajustar.\n\n' ||
    E'HALLERTAU: la receta base dice 20 g y el cronograma 30 g. Acá se usa el\n' ||
    E'cronograma (500 g/500 L). Si se confirman los 20 g, bajar a ≈333 g.\n\n' ||
    E'La cerveza se libera por condición, no por calendario.';

  r          record;
  v_prod_id  uuid;
  v_vendible uuid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Insumos
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM jsonb_array_elements(v_insumos) AS t(j)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM cerveceriaerp.productos
       WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = (r.j ->> 'sku')
    ) THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock)
      VALUES
        (v_empresa, v_sucursal, r.j ->> 'nombre', r.j ->> 'sku', r.j ->> 'unidad', 0,
         0, 0, true, true);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. Producto del lote a granel: es el que la receta produce
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_prod_id FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = 'CV-BL-GRANEL';
  IF v_prod_id IS NULL THEN
    INSERT INTO cerveceriaerp.productos
      (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
       precio_venta, stock_actual, activo, controla_stock)
    VALUES
      (v_empresa, v_sucursal, 'Coven Blonde Ale (granel)', 'CV-BL-GRANEL', 'L', 0,
       0, 0, true, true)
    RETURNING id INTO v_prod_id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. Receta
  -- ---------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta_id) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = 'Coven Blonde Ale 500 L',
           rendimiento_cantidad = 500,
           rendimiento_unidad = 'L',
           merma_proceso_pct = 0.06,
           notas = v_notas,
           activa = true,
           updated_at = now()
     WHERE id = v_receta_id;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, merma_proceso_pct, notas, activa)
    VALUES
      (v_receta_id, v_empresa, v_sucursal, v_prod_id, 'Coven Blonde Ale 500 L',
       500, 'L', 0.06, v_notas, true);
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Insumos de la receta
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM jsonb_array_elements(v_items) AS t(j)
  LOOP
    SELECT id INTO v_prod_id FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = (r.j ->> 'sku');

    IF EXISTS (SELECT 1 FROM cerveceriaerp.receta_items
                WHERE receta_id = v_receta_id AND insumo_producto_id = v_prod_id) THEN
      UPDATE cerveceriaerp.receta_items
         SET cantidad = (r.j ->> 'cantidad')::numeric,
             unidad_medida = r.j ->> 'unidad',
             orden = (r.j ->> 'orden')::int
       WHERE receta_id = v_receta_id AND insumo_producto_id = v_prod_id;
    ELSE
      INSERT INTO cerveceriaerp.receta_items
        (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
      VALUES
        (v_receta_id, v_empresa, v_prod_id, (r.j ->> 'cantidad')::numeric,
         r.j ->> 'unidad', 0, (r.j ->> 'orden')::int);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 5. Formatos de venta
  -- ---------------------------------------------------------------------------
  FOR r IN SELECT * FROM jsonb_array_elements(v_formatos) AS t(j)
  LOOP
    SELECT id INTO v_vendible FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = (r.j ->> 'sku');

    IF v_vendible IS NULL THEN
      INSERT INTO cerveceriaerp.productos
        (empresa_id, sucursal_id, nombre, sku, unidad_medida, costo_promedio,
         precio_venta, stock_actual, activo, controla_stock, margen_objetivo_pct)
      VALUES
        (v_empresa, v_sucursal, r.j ->> 'nombre', r.j ->> 'sku', 'UNIDAD', 0,
         0, 0, true, true, (r.j ->> 'margen')::numeric)
      RETURNING id INTO v_vendible;
    ELSE
      UPDATE cerveceriaerp.productos
         SET margen_objetivo_pct = coalesce(margen_objetivo_pct, (r.j ->> 'margen')::numeric)
       WHERE id = v_vendible;
    END IF;

    INSERT INTO cerveceriaerp.receta_formatos
      (receta_id, empresa_id, sucursal_id, producto_id, capacidad, capacidad_unidad, orden)
    VALUES
      (v_receta_id, v_empresa, v_sucursal, v_vendible,
       (r.j ->> 'capacidad')::numeric, r.j ->> 'unidad', (r.j ->> 'orden')::int)
    ON CONFLICT (receta_id, producto_id) DO UPDATE
      SET capacidad = EXCLUDED.capacidad,
          capacidad_unidad = EXCLUDED.capacidad_unidad,
          orden = EXCLUDED.orden,
          updated_at = now();
  END LOOP;

  RAISE NOTICE 'Receta Coven Blonde Ale 500 L cargada (%).', v_receta_id;
  RAISE NOTICE 'Falta cargar el COSTO de los insumos: se llena con la primera compra registrada.';
END
$receta$;

COMMIT;

-- PostgREST cachea el schema: sin esto la app no ve lo que acaba de cambiar.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- Verificación — el costo da 0 hasta que haya compras de los insumos
-- =============================================================================
SELECT i.orden, p.nombre AS insumo, i.cantidad, i.unidad_medida,
       p.costo_promedio, (i.cantidad * p.costo_promedio) AS subcosto
  FROM cerveceriaerp.receta_items i
  JOIN cerveceriaerp.productos p ON p.id = i.insumo_producto_id
 WHERE i.receta_id = '0e117500-911b-4ead-b909-544c9e7fff3b'
 ORDER BY i.orden;

SELECT jsonb_pretty(
  cerveceriaerp.fn_receta_costeo('0e117500-911b-4ead-b909-544c9e7fff3b') - 'items'
) AS costeo;
