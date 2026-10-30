/**
 * Tests de `lineasPagoTicket`.
 *
 * El caso que motivó esto: TODOS los tickets decían "Pago: Efectivo". La causa
 * era una venta a CRÉDITO, que sale con `metodo_pago = 'efectivo'` porque ese
 * es el valor por defecto del formulario y con condición Crédito el selector
 * de cobro ni se muestra. El ticket imprimía ese valor tal cual y afirmaba que
 * se había cobrado en efectivo algo que no se cobró.
 *
 * Correr con: npm run test:ticket-pago
 */
import { lineasPagoTicket, type DatosPagoTicket } from "../src/lib/ventas/ticket-pago";

const gs = (n: number) => "Gs. " + Math.round(n).toLocaleString("es-PY");

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}
function filas(d: Partial<DatosPagoTicket>) {
  return lineasPagoTicket(
    { tipo_venta: "CONTADO", plazo_dias: null, metodo_pago: null, pagos_desglose: null, ...d },
    gs
  );
}
const texto = (d: Partial<DatosPagoTicket>) =>
  filas(d).map((l) => `${l.label.trim()}=${l.valor}`).join(" | ");

console.log("\nEl bug: una venta a credito decia Efectivo");
{
  const t = texto({ tipo_venta: "CREDITO", plazo_dias: 30, metodo_pago: "efectivo" });
  ok("credito con plazo dice credito y el plazo", t === "Pago=Crédito a 30 días", t);
  ok("no menciona efectivo por ningun lado", !t.toLowerCase().includes("efectivo"), t);
}
{
  const t = texto({ tipo_venta: "CREDITO", plazo_dias: null, metodo_pago: "efectivo" });
  ok("credito sin plazo igual dice credito", t === "Pago=Crédito", t);
}

console.log("\nMetodos simples");
ok("efectivo", texto({ metodo_pago: "efectivo" }) === "Pago=Efectivo");
ok("transferencia", texto({ metodo_pago: "transferencia" }) === "Pago=Transferencia");
ok("tarjeta usa la etiqueta compartida",
   texto({ metodo_pago: "tarjeta" }) === "Pago=Tarjeta o débito",
   texto({ metodo_pago: "tarjeta" }));
ok("sin metodo no inventa uno", texto({ metodo_pago: null }) === "Pago=—");
ok("un metodo desconocido no se imprime como efectivo",
   texto({ metodo_pago: "cripto" }) === "Pago=—",
   texto({ metodo_pago: "cripto" }));

console.log("\nMixto: el cliente tiene que ver el reparto");
{
  const f = filas({
    metodo_pago: "mixto",
    pagos_desglose: { efectivo: 50000, tarjeta: 30000, transferencia: 0 },
  });
  ok("encabeza con Mixto", f[0].label === "Pago" && f[0].valor === "Mixto");
  ok("detalla solo los metodos usados", f.length === 3, JSON.stringify(f));
  ok("muestra los montos",
     f.some((l) => l.valor === gs(50000)) && f.some((l) => l.valor === gs(30000)),
     JSON.stringify(f));
  ok("no lista el metodo en cero",
     !f.some((l) => l.label.includes("Transferencia")),
     JSON.stringify(f));
}
{
  const f = filas({ metodo_pago: "mixto", pagos_desglose: null });
  ok("mixto sin reparto dice Mixto y no inventa un metodo",
     f.length === 1 && f[0].valor === "Mixto", JSON.stringify(f));
}
{
  // Crédito manda sobre todo: no se cobró, no hay reparto que mostrar.
  const f = filas({
    tipo_venta: "CREDITO", plazo_dias: 15,
    metodo_pago: "mixto", pagos_desglose: { efectivo: 10000 },
  });
  ok("credito gana sobre mixto", f.length === 1 && f[0].valor === "Crédito a 15 días");
}

console.log("\nBanco y referencia, que es con lo que se concilia");
{
  const f = filas({
    metodo_pago: "transferencia",
    detalle: [{ metodo_pago: "transferencia", entidad_nombre_snapshot: "Banco Itaú", referencia: "0012345" }],
  });
  ok("agrega banco y referencia",
     f.length === 2 && f[1].valor === "Banco Itaú · 0012345", JSON.stringify(f));
}
{
  const f = filas({
    metodo_pago: "tarjeta",
    detalle: [{ metodo_pago: "tarjeta", entidad_nombre_snapshot: "POS Bancard", referencia: null }],
  });
  ok("con solo el banco no deja un separador colgando",
     f[1].valor === "POS Bancard", JSON.stringify(f));
}
{
  const f = filas({
    metodo_pago: "efectivo",
    detalle: [{ metodo_pago: "transferencia", entidad_nombre_snapshot: "Banco Itaú", referencia: "1" }],
  });
  ok("no pega el banco de otro metodo", f.length === 1, JSON.stringify(f));
}
{
  const f = filas({
    metodo_pago: "transferencia",
    detalle: [{ metodo_pago: "transferencia", entidad_nombre_snapshot: "  ", referencia: "  " }],
  });
  ok("entidad vacia no genera una linea en blanco", f.length === 1, JSON.stringify(f));
}
{
  const f = filas({
    metodo_pago: "mixto",
    pagos_desglose: { efectivo: 20000, transferencia: 80000 },
    detalle: [{ metodo_pago: "transferencia", entidad_nombre_snapshot: "Banco Itaú", referencia: "77" }],
  });
  ok("en mixto el banco cuelga del metodo que corresponde",
     f.some((l) => l.valor === "Banco Itaú · 77"), JSON.stringify(f));
}

console.log("\nDatos rotos no rompen el ticket");
ok("desglose que no es objeto", filas({ metodo_pago: "mixto", pagos_desglose: "x" }).length === 1);
ok("detalle null", filas({ metodo_pago: "tarjeta", detalle: null }).length === 1);
ok("monto negativo no se lista",
   !filas({ metodo_pago: "mixto", pagos_desglose: { efectivo: -5, tarjeta: 100 } })
     .some((l) => l.valor.includes("-")));

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
