#!/usr/bin/env python3
"""Genera supabase/cerveceria/12_carga_coven_planillas.sql desde las planillas."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import catalogo as C
from lotes import todos

def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

P = []
w = P.append

w("""-- =============================================================================
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
DECLARE""")
w(f"  v_empresa  CONSTANT uuid := '{C.EMPRESA}';")
w(f"  v_sucursal CONSTANT uuid := '{C.SUCURSAL}';")
w("""  r          record;
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
  -- cargarles una compra o una factura.""")
for nom, nota in C.PROVEEDORES:
    w(f"""  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.proveedores
                  WHERE empresa_id = v_empresa AND upper(nombre) = upper({q(nom)})) THEN
    INSERT INTO cerveceriaerp.proveedores (empresa_id, nombre, estado, observaciones)
    VALUES (v_empresa, {q(nom)}, 'activo', {q(nota + ' Falta el RUC.')});
  END IF;""")

w("""
  -- ---------------------------------------------------------------------------
  -- 2. Insumos
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES""")
filas = [f"      ({q(s)}, {q(n)}, {q(u)}, {c}::numeric, {q(o)})" for s, n, u, c, o in C.INSUMOS]
w(",\n".join(filas))
w("""    ) AS t(sku, nombre, unidad, costo, origen)
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
    SELECT * FROM (VALUES""")
w(",\n".join(f"      ({q(s)}, {q(n)})" for s, n in C.GRANELES))
w("""    ) AS t(sku, nombre)
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
""")

# ---- recetas
w("""  -- ---------------------------------------------------------------------------
  -- 4. Recetas
  -- ---------------------------------------------------------------------------""")
for rec in C.RECETAS:
    w(f"""
  -- {rec['nombre']} — {rec['origen']}
  SELECT id INTO v_granel FROM cerveceriaerp.productos
   WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = {q(rec['sku_granel'])};
  v_receta := {q(rec['id'])}::uuid;

  IF EXISTS (SELECT 1 FROM cerveceriaerp.recetas WHERE id = v_receta) THEN
    UPDATE cerveceriaerp.recetas
       SET nombre = {q(rec['nombre'])}, producto_id = v_granel,
           rendimiento_cantidad = {rec['rendimiento']}, rendimiento_unidad = {q(rec['unidad'])},
           notas = {q('Derivada de ' + rec['origen'] + '.')},
           activa = {str(rec['activa']).lower()}, updated_at = now()
     WHERE id = v_receta;
  ELSE
    INSERT INTO cerveceriaerp.recetas
      (id, empresa_id, sucursal_id, producto_id, nombre,
       rendimiento_cantidad, rendimiento_unidad, notas, activa)
    VALUES
      (v_receta, v_empresa, v_sucursal, v_granel, {q(rec['nombre'])},
       {rec['rendimiento']}, {q(rec['unidad'])}, {q('Derivada de ' + rec['origen'] + '.')},
       {str(rec['activa']).lower()});
  END IF;

  DELETE FROM cerveceriaerp.receta_items WHERE receta_id = v_receta;
  FOR r IN
    SELECT * FROM (VALUES""")
    w(",\n".join(f"      ({q(s)}, {c}::numeric, {q(u)}, {i+1})"
                 for i, (s, c, u) in enumerate(rec["items"])))
    w("""    ) AS t(sku, cantidad, unidad, orden)
  LOOP
    SELECT id INTO v_prod FROM cerveceriaerp.productos
     WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal AND sku = r.sku;
    INSERT INTO cerveceriaerp.receta_items
      (receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
    VALUES (v_receta, v_empresa, v_prod, r.cantidad, r.unidad, 0, r.orden);
  END LOOP;""")

# ---- lotes
w("""
  -- ---------------------------------------------------------------------------
  -- 5. Lotes historicos
  -- ---------------------------------------------------------------------------
  -- Entran CERRADOS y sin fermentador: ya pasaron. Sin fermentador tampoco
  -- chocan con el indice que impide dos lotes activos en el mismo tanque.
  -- El consumo y el costo de insumos quedan en `observaciones` porque las
  -- planillas piloto no dicen cuantos litros rindio cada cocimiento, y sin
  -- volumen no se puede armar una produccion costeada por litro.
  FOR r IN
    SELECT * FROM (VALUES""")
filas = []
for l in todos():
    estilo, sku = l["estilo"]
    obs = (f"Cargado de la planilla de coccion. Estilo {estilo}. "
           f"Proveedor {l['proveedor']}. "
           f"Costo de insumos {l['costo']:,.0f} Gs (no incluye mano de obra ni energia). "
           f"Consumo: {l['detalle']}.")
    vol = "NULL" if l["volumen"] is None else str(l["volumen"])
    filas.append(f"      ({q(l['codigo'])}, {q(sku)}, {q(l['fecha'])}::date, {vol}, {q(obs)})")
w(",\n".join(filas))
w("""    ) AS t(codigo, sku_granel, fecha, volumen, observaciones)
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
 WHERE empresa_id = '""" + C.EMPRESA + """'
UNION ALL SELECT 'insumos', count(*) FROM cerveceriaerp.productos
 WHERE empresa_id = '""" + C.EMPRESA + """' AND es_insumo
UNION ALL SELECT 'recetas', count(*) FROM cerveceriaerp.recetas
 WHERE empresa_id = '""" + C.EMPRESA + """'
UNION ALL SELECT 'lotes', count(*) FROM cerveceriaerp.produccion_lotes
 WHERE empresa_id = '""" + C.EMPRESA + """';
-- Esperado: proveedores >= 2 · insumos >= 23 · recetas >= 5 · lotes 15

-- Costeo de la unica receta con rendimiento real (Session IPA 500 L):
SELECT i.orden, p.nombre AS insumo, i.cantidad, i.unidad_medida,
       p.costo_promedio, round(i.cantidad * p.costo_promedio) AS subcosto
  FROM cerveceriaerp.receta_items i
  JOIN cerveceriaerp.productos p ON p.id = i.insumo_producto_id
 WHERE i.receta_id = '""" + C.RECETAS[0]["id"] + """'
 ORDER BY i.orden;

-- ---------------------------------------------------------------------------
-- Para despues: activar las recetas piloto cargandoles el rendimiento real
-- ---------------------------------------------------------------------------
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = '""" + C.RECETAS[1]["id"] + """';  -- Blonde Ale Ligera (piloto)
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = '""" + C.RECETAS[2]["id"] + """';  -- Blonde Ale (piloto)
-- UPDATE cerveceriaerp.recetas SET rendimiento_cantidad = <litros>, activa = true
--  WHERE id = '""" + C.RECETAS[3]["id"] + """';  -- Session IPA (piloto)""")

salida = pathlib.Path("supabase/cerveceria/12_carga_coven_planillas.sql")
salida.write_text("\n".join(P) + "\n")
print("escrito", salida, len("\n".join(P)), "bytes")
