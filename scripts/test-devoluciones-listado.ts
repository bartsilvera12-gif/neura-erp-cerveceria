/**
 * Tests del listado de devoluciones.
 *
 * Lo que importa: que lo que volvió de una vez se muestre como UNA devolución
 * (si no, parece que el cliente vino cuatro veces), que la plata salga del
 * precio que cobró esa venta, y que el motivo se vea sin el número de factura
 * repetido.
 *
 * Correr con: npm run test:devoluciones
 */
import {
  agruparDevoluciones,
  motivoDeReferencia,
  totalesDevoluciones,
  type MovimientoDevolucion,
} from "../src/lib/ventas/devoluciones-listado";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const mov = (p: Partial<MovimientoDevolucion>): MovimientoDevolucion => ({
  id: "m", venta_id: "v1", producto_id: "p1", producto_nombre: "Chop", producto_sku: "BAR-1",
  cantidad: 1, fecha: "2026-11-02T18:00:00.000Z", referencia: null, usuario_nombre: "Karen", ...p,
});

const precios = new Map([["v1:p1", 25000], ["v1:p2", 45000], ["v2:p1", 20000]]);
const numeros = new Map([["v1", "001-001-0000001"], ["v2", "001-001-0000002"]]);

console.log("\nAgrupar");
{
  const d = agruparDevoluciones([
    mov({ id: "a", producto_id: "p1", cantidad: 2 }),
    mov({ id: "b", producto_id: "p2", producto_nombre: "Hamburguesa", cantidad: 1 }),
  ], precios, numeros);
  ok("lo que volvió junto es una sola devolución", d.length === 1, String(d.length));
  ok("con sus dos productos", d[0].items.length === 2);
  ok("suma las unidades", d[0].unidades === 3);
  // La plata sale del precio que cobró ESA venta, no del precio de hoy.
  ok("suma la plata", d[0].monto === 2 * 25000 + 45000, String(d[0].monto));
  ok("trae el número de la venta", d[0].numero_control === "001-001-0000001");
}

console.log("\nDos momentos distintos");
{
  const d = agruparDevoluciones([
    mov({ id: "a", fecha: "2026-11-02T18:00:00.000Z", cantidad: 1 }),
    mov({ id: "b", fecha: "2026-11-03T10:00:00.000Z", cantidad: 1 }),
  ], precios, numeros);
  ok("son dos devoluciones", d.length === 2);
  // El que entra a la pantalla viene a ver lo último que pasó.
  ok("la más nueva primero", d[0].fecha === "2026-11-03T10:00:00.000Z");
}

console.log("\nDos ventas a la misma hora");
{
  const d = agruparDevoluciones([
    mov({ id: "a", venta_id: "v1" }),
    mov({ id: "b", venta_id: "v2" }),
  ], precios, numeros);
  ok("no se mezclan", d.length === 2);
  ok("cada una con su precio", d.map((x) => x.monto).sort((a, b) => a - b).join(",") === "20000,25000");
}

console.log("\nMotivo");
{
  ok("saca el número repetido", motivoDeReferencia("Devolución FAC-001 · se picó la cerveza") === "se picó la cerveza");
  ok("sin motivo da null", motivoDeReferencia("Devolución FAC-001") === null);
  ok("vacío da null", motivoDeReferencia("") === null);
  ok("null da null", motivoDeReferencia(null) === null);
  const d = agruparDevoluciones([mov({ referencia: "Devolución X · vino fallado" })], precios, numeros);
  ok("llega a la fila", d[0].motivo === "vino fallado");
}

console.log("\nLo que no entra");
{
  const d = agruparDevoluciones([mov({ cantidad: 0 }), mov({ cantidad: -3 })], precios, numeros);
  ok("cantidades en cero o negativas se ignoran", d.length === 0);
  // Un producto sin precio en esa venta (borrado, o venta vieja) no rompe la lista.
  const sinPrecio = agruparDevoluciones([mov({ producto_id: "zzz", cantidad: 2 })], precios, numeros);
  ok("sin precio, monto 0", sinPrecio[0].monto === 0 && sinPrecio[0].unidades === 2);
}

console.log("\nTotales");
{
  const d = agruparDevoluciones([
    mov({ id: "a", cantidad: 2 }),
    mov({ id: "b", fecha: "2026-11-01T10:00:00.000Z", cantidad: 1 }),
  ], precios, numeros);
  const t = totalesDevoluciones(d);
  ok("cuenta las devoluciones", t.cantidad === 2);
  ok("suma unidades", t.unidades === 3);
  ok("suma plata", t.monto === 75000, String(t.monto));
  const vacio = totalesDevoluciones([]);
  ok("sin devoluciones, todo en cero", vacio.cantidad === 0 && vacio.unidades === 0 && vacio.monto === 0);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
