#!/usr/bin/env python3
"""Genera supabase/cerveceria/15_compras_historicas.sql."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from catalogo import EMPRESA, SUCURSAL
from compras import todas

def q(s):
    return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

compras = todas()
# El ERP deja en `costo_promedio` el costo de la ULTIMA compra (no promedia,
# pese al nombre). Se replica igual para que el numero no dependa de si lo
# cargo este script o la pantalla de Compras.
ultimo = {}
for c in sorted(compras, key=lambda x: x["fecha"]):
    for l in c["lineas"]:
        ultimo[l["sku"]] = l["costo_unitario"]

P = []; w = P.append
w(f"""-- =============================================================================
-- 15. Compras historicas de las planillas de coccion
-- =============================================================================
--
-- POR QUE HACE FALTA
-- El costeo de una receta multiplica cantidad x `costo_promedio` del insumo, y
-- ese costo lo llena el ERP con las compras. Sin ninguna compra cargada todo el
-- costeo da 0 y el precio sugerido no existe. Las planillas de coccion tienen
-- el precio de cada insumo de cada lote: son las compras que faltaban.
--
-- QUE DEJA
--   · {len(compras)} compras ({sum(len(c['lineas']) for c in compras)} lineas), una por lote, con su fecha y proveedor.
--   · El movimiento de ENTRADA de cada linea.
--   · El movimiento de SALIDA del consumo de ese lote.
--   · `costo_promedio` de {len(ultimo)} insumos.
--   · La relacion proveedor-producto con su costo habitual.
--
-- EL STOCK NO QUEDA INFLADO
-- Cada fila de las planillas es lo que se COMPRO PARA ese lote, asi que compra
-- y consumo son la misma cantidad. Por eso el script carga las dos puntas: lo
-- que entra por la compra sale por el cocimiento. Si cargara solo las compras,
-- el deposito quedaria con 1.400 kg de malta que se uso hace meses.
--
-- SOBRE EL IVA: las planillas traen un importe y nada mas, sin discriminar.
-- Las compras entran como `exenta` con IVA 0 porque inventar un 10%% seria
-- fabricar un dato fiscal. NO USAR estas compras para el libro de IVA; estan
-- para costear. Se reconocen por el `numero_control`, que empieza con HIST-.
--
-- EL COSTO QUE QUEDA es el de la ULTIMA compra de cada insumo, que es lo que
-- hace el ERP cuando se carga una compra desde la pantalla (no promedia, pese
-- al nombre de la columna). Asi el numero es el mismo venga de donde venga.
--
-- Idempotente: las compras se saltean por `numero_control`.
-- Solo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $compras$
DECLARE
  v_empresa  CONSTANT uuid := '{EMPRESA}';
  v_sucursal CONSTANT uuid := '{SUCURSAL}';
  c          record;
  l          record;
  v_prov     uuid;
  v_prod     uuid;
  v_nombre   text;
  v_sku      text;
  v_n        int := 0;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES""")

filas = []
for c in compras:
    lineas_json = []
    for l in c["lineas"]:
        lineas_json.append(
            '{"sku":"%s","cantidad":%s,"costo":%s,"total":%s,"origen":%s}'
            % (l["sku"], round(l["cantidad"], 6), round(l["costo_unitario"], 6),
               round(l["total"], 2), q(l["origen"]).replace("'", '"')))
    filas.append(
        f"      ({q(c['numero'])}, {q(c['codigo'])}, {q(c['fecha'])}::date, {q(c['proveedor'])},\n"
        f"       '[{','.join(lineas_json)}]'::jsonb)")
w(",\n".join(filas))
w("""    ) AS t(numero, lote, fecha, proveedor, lineas)
  LOOP
    -- Idempotencia: si la compra ya esta, no se vuelve a cargar ni a mover stock.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM cerveceriaerp.compras
       WHERE empresa_id = v_empresa AND numero_control = c.numero
    );

    -- `compras.proveedor_id` es NOT NULL, asi que el proveedor no es opcional:
    -- si no esta, se crea. Antes este script asumia que ya lo habia dejado el
    -- 12 y, cuando no, fallaba recien en el INSERT con un error de constraint
    -- que no dice que hacer.
    SELECT id INTO v_prov FROM cerveceriaerp.proveedores
     WHERE empresa_id = v_empresa AND upper(trim(nombre)) = upper(trim(c.proveedor))
     LIMIT 1;

    IF v_prov IS NULL THEN
      INSERT INTO cerveceriaerp.proveedores (empresa_id, nombre, estado, observaciones)
      VALUES (v_empresa, c.proveedor, 'activo',
              'Creado por la carga de compras historicas. Falta el RUC.')
      RETURNING id INTO v_prov;
      RAISE NOTICE 'Proveedor % creado (no estaba).', c.proveedor;
    END IF;

    FOR l IN SELECT * FROM jsonb_array_elements(c.lineas) AS x(j)
    LOOP
      SELECT id, nombre, sku INTO v_prod, v_nombre, v_sku
        FROM cerveceriaerp.productos
       WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal
         AND sku = (l.j ->> 'sku');
      IF v_prod IS NULL THEN
        RAISE EXCEPTION 'Falta el insumo % (correr antes el script 12).', l.j ->> 'sku';
      END IF;

      INSERT INTO cerveceriaerp.compras
        (empresa_id, sucursal_id, proveedor_id, proveedor_nombre,
         producto_id, producto_nombre, cantidad, moneda, tipo_cambio,
         costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, numero_control, estado, fecha, fecha_factura, metodo_pago,
         usuario_nombre)
      VALUES
        (v_empresa, v_sucursal, v_prov, c.proveedor,
         v_prod, v_nombre, (l.j ->> 'cantidad')::numeric, 'PYG', 1,
         (l.j ->> 'costo')::numeric, (l.j ->> 'costo')::numeric,
         'exenta', (l.j ->> 'total')::numeric, 0, (l.j ->> 'total')::numeric, 0, 0,
         'contado', c.numero, 'registrada', c.fecha::timestamptz, c.fecha, 'efectivo',
         'Carga historica');

      -- Entra por la compra...
      INSERT INTO cerveceriaerp.movimientos_inventario
        (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre)
      VALUES
        (v_empresa, v_sucursal, v_prod, v_nombre, v_sku,
         'ENTRADA', (l.j ->> 'cantidad')::numeric, (l.j ->> 'costo')::numeric,
         'compra', c.numero, c.fecha::timestamptz, 'Carga historica');

      -- ...y sale por el cocimiento, el mismo dia y la misma cantidad.
      INSERT INTO cerveceriaerp.movimientos_inventario
        (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre)
      VALUES
        (v_empresa, v_sucursal, v_prod, v_nombre, v_sku,
         'SALIDA', (l.j ->> 'cantidad')::numeric, (l.j ->> 'costo')::numeric,
         'produccion', c.lote, c.fecha::timestamptz, 'Carga historica');

      -- A quien se le compra y a cuanto. No pisa el proveedor principal si ya hay uno.
      BEGIN
        INSERT INTO cerveceriaerp.proveedor_productos
          (empresa_id, producto_id, proveedor_id, costo_habitual, es_principal, updated_at)
        VALUES (v_empresa, v_prod, v_prov, (l.j ->> 'costo')::numeric,
                NOT EXISTS (SELECT 1 FROM cerveceriaerp.proveedor_productos pp
                             WHERE pp.empresa_id = v_empresa AND pp.producto_id = v_prod
                               AND pp.es_principal),
                now())
        ON CONFLICT (empresa_id, producto_id, proveedor_id)
        DO UPDATE SET costo_habitual = EXCLUDED.costo_habitual, updated_at = now();
      EXCEPTION WHEN undefined_table THEN
        NULL;  -- instalacion sin `proveedor_productos`: la compra igual vale
      END;
    END LOOP;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Compras historicas cargadas en esta corrida: %.', v_n;
END
$compras$;

-- ---------------------------------------------------------------------------
-- Costo de cada insumo: el de su ULTIMA compra, igual que hace la pantalla
-- ---------------------------------------------------------------------------
-- Se escribe aparte y no dentro del bucle para que el resultado no dependa del
-- orden en que se recorrieron las compras.
UPDATE cerveceriaerp.productos p
   SET costo_promedio = u.costo, updated_at = now()
  FROM (
    SELECT DISTINCT ON (producto_id) producto_id, costo_unitario AS costo
      FROM cerveceriaerp.movimientos_inventario
     WHERE empresa_id = '""" + EMPRESA + """'
       AND tipo = 'ENTRADA' AND origen = 'compra'
     ORDER BY producto_id, fecha DESC, id DESC
  ) u
 WHERE p.id = u.producto_id
   AND p.empresa_id = '""" + EMPRESA + """'
   AND p.costo_promedio IS DISTINCT FROM u.costo;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
SELECT 'compras' AS que, count(*) FROM cerveceriaerp.compras
 WHERE empresa_id = '""" + EMPRESA + """' AND numero_control LIKE 'HIST-%'
UNION ALL
SELECT 'movimientos', count(*) FROM cerveceriaerp.movimientos_inventario
 WHERE empresa_id = '""" + EMPRESA + """' AND usuario_nombre = 'Carga historica'
UNION ALL
SELECT 'insumos con costo', count(*) FROM cerveceriaerp.productos
 WHERE empresa_id = '""" + EMPRESA + """' AND es_insumo AND costo_promedio > 0;

-- El stock de los insumos tiene que quedar como estaba: lo que entro salio.
SELECT p.sku, p.nombre, p.stock_actual, round(p.costo_promedio) AS costo
  FROM cerveceriaerp.productos p
 WHERE p.empresa_id = '""" + EMPRESA + """' AND p.es_insumo
 ORDER BY p.sku;

-- Lo que SIGUE sin costo, si queda algo. Un insumo en 0 no rompe el costeo:
-- lo deja mas barato de lo que es, que es peor, porque no se nota.
SELECT sku, nombre
  FROM cerveceriaerp.productos
 WHERE empresa_id = '""" + EMPRESA + """' AND es_insumo AND coalesce(costo_promedio, 0) = 0
 ORDER BY sku;
-- Esperado: MP-CARADEX y LV-AY4, que la receta del script 07 usa pero ningun
-- lote de las planillas compro nunca. Ver docs/CARGA-PLANILLAS-COVEN.md.

-- Y el costeo de las recetas ya no da 0:
SELECT r.nombre,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_total')::numeric)    AS costo_lote,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_unitario')::numeric) AS costo_por_litro
  FROM cerveceriaerp.recetas r
 WHERE r.empresa_id = '""" + EMPRESA + """' AND r.activa
 ORDER BY r.nombre;""")

salida = pathlib.Path("supabase/cerveceria/15_compras_historicas.sql")
salida.write_text("\n".join(P) + "\n")
print("escrito", salida, len(compras), "compras")
