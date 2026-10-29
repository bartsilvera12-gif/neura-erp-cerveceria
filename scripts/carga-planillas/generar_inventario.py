#!/usr/bin/env python3
"""Genera supabase/cerveceria/13_inventario_fabrica.sql desde inventario-fabrica.xlsx."""
import sys, re, pathlib, openpyxl
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from inventario import NOMBRES, CATEGORIAS
from catalogo import EMPRESA, SUCURSAL

XLSX = pathlib.Path("/tmp/claude-0/-home-user/8ac83d0d-fefb-5541-b3aa-b541619709c1/"
                    "scratchpad/planillas/e68901a2-2052251b-5073-4d90-95d6-a43c0616d0d5-"
                    "inventario-fabrica.xlsx")

def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

def ubi(v):
    """`tupeer rojo 1`, `BOX 12-1`, `box29-2` y `box 29/3` son la misma forma
    de nombrar escrita de distintas maneras."""
    u = re.sub(r"\s+", " ", str(v or "SIN UBICACION").strip().upper())
    u = u.replace("TUPEER", "TUPPER").replace("/", "-")
    return re.sub(r"^(BOX|TUPPER)\s*", r"\1 ", u)

filas, ubis = [], {}
ws = openpyxl.load_workbook(XLSX, data_only=True)["Hoja1"]
i = 0
for row in ws.iter_rows(min_row=3, values_only=True):
    if not row[1]:
        continue
    i += 1
    art, cant, u = row[1].strip(), row[2], ubi(row[3])
    nombre, cat = NOMBRES[art]
    contado = cant not in (None, "") and str(cant).strip() != "0000"
    filas.append(dict(sku=f"FAB-{i:03d}", nombre=nombre, cat=cat, ubi=u,
                      cantidad=(float(cant) if contado else 0), contado=contado,
                      original=art))
    ubis[u] = True

P = []; w = P.append
w(f"""-- =============================================================================
-- 13. Inventario de planta
-- =============================================================================
--
-- Los 57 articulos de ferreteria y repuestos de `inventario-fabrica.xlsx`, con
-- la ubicacion fisica donde estan guardados ({len(ubis)} ubicaciones: tuppers y cajas).
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
  v_empresa  CONSTANT uuid := '{EMPRESA}';
  v_sucursal CONSTANT uuid := '{SUCURSAL}';
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
    SELECT * FROM (VALUES""")
w(",\n".join(f"      ({q(k)}, {q(v)})" for k, v in CATEGORIAS.items()))
w("""    ) AS t(codigo, nombre)
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
    SELECT * FROM (VALUES""")
w(",\n".join(f"      ({q(u)})" for u in sorted(ubis)))
w("""    ) AS t(nombre)
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
    SELECT * FROM (VALUES""")
w(",\n".join(
    f"      ({q(f['sku'])}, {q(f['nombre'])}, {q(CATEGORIAS[f['cat']])}, "
    f"{q(f['ubi'])}, {f['cantidad']}::numeric, {str(f['contado']).lower()})"
    for f in filas))
w("""    ) AS t(sku, nombre, categoria, ubicacion, cantidad, contado)
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
 WHERE p.empresa_id = '""" + EMPRESA + """' AND p.sku LIKE 'FAB-%'
 GROUP BY u.nombre ORDER BY u.nombre;
-- Esperado: """ + str(len(ubis)) + """ ubicaciones, """ + str(len(filas)) + """ articulos, 10 sin contar.

SELECT sku, nombre FROM cerveceriaerp.productos
 WHERE empresa_id = '""" + EMPRESA + """' AND sku LIKE 'FAB-%' AND NOT controla_stock
 ORDER BY sku;

-- ---------------------------------------------------------------------------
-- Para despues: cuando se cuente una caja de surtido
-- ---------------------------------------------------------------------------
-- UPDATE cerveceriaerp.productos SET controla_stock = true, stock_actual = <contado>
--  WHERE sku = 'FAB-0nn';
-- y cargar el movimiento desde Inventario para que el kardex lo explique.""")

salida = pathlib.Path("supabase/cerveceria/13_inventario_fabrica.sql")
salida.write_text("\n".join(P) + "\n")
print("escrito", salida, len(filas), "articulos,", len(ubis), "ubicaciones")
