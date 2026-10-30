/**
 * Tests de `normalizarGastoInput`.
 *
 * El caso que motivó esto: "cree un gasto y no se creó". El alta escribía
 * directo desde el browser y resolvía la sucursal con
 * `usuarios.sucursal_predeterminada_id`, mientras la lista la resolvía con la
 * sucursal ACTIVA. Parado en una sucursal distinta de su predeterminada, el
 * gasto se guardaba en la otra: sin error y sin aparecer en ninguna pantalla.
 *
 * El alta pasó a `POST /api/gastos`, que usa la misma sucursal que el GET. Esto
 * prueba la parte que se puede probar sin base: qué entra y qué se rechaza.
 *
 * Correr con: npm run test:gasto-payload
 */
import { normalizarGastoInput } from "../src/lib/gastos/payload";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const alta = (b: unknown) => normalizarGastoInput(b, { parcial: false });
const edicion = (b: unknown) => normalizarGastoInput(b, { parcial: true });

const base = {
  categoria: "SERVICIOS",
  descripcion: "ANDE SETIEMBRE",
  monto: 450000,
  tipo: "variable",
  recurrente: true,
  frecuencia: "MENSUAL",
  fecha: "2026-10-30",
  beneficiario: "ANDE",
  metodo_pago: "transferencia",
};

console.log("\nAlta valida");
{
  const r = alta(base);
  ok("acepta un gasto completo", r.ok === true, JSON.stringify(r));
  if (r.ok) {
    ok("monto como numero", r.campos.monto === 450000);
    ok("fecha tal cual", r.campos.fecha === "2026-10-30");
    ok("metodo de pago tal cual", r.campos.metodo_pago === "transferencia");
    ok("recurrente booleano", r.campos.recurrente === true);
  }
}
{
  const r = alta({ monto: "125000", fecha: "2026-01-05" });
  ok("monto que viene como string se convierte", r.ok === true && r.campos.monto === 125000, JSON.stringify(r));
  if (r.ok) {
    ok("tipo por defecto variable", r.campos.tipo === "variable");
    ok("recurrente por defecto false", r.campos.recurrente === false);
    ok("metodo de pago por defecto null", r.campos.metodo_pago === null);
    ok("categoria ausente queda null", r.campos.categoria === null);
  }
}
{
  const r = alta({ ...base, categoria: "   ", beneficiario: "  ANDE  " });
  ok("string vacio queda null", r.ok === true && r.campos.categoria === null, JSON.stringify(r));
  ok("string con espacios se recorta", r.ok === true && r.campos.beneficiario === "ANDE");
}

console.log("\nAlta rechazada (antes esto llegaba a Postgres o se guardaba mal)");
for (const [nombre, body] of [
  ["sin monto", { fecha: "2026-10-30" }],
  ["monto 0", { ...base, monto: 0 }],
  ["monto negativo", { ...base, monto: -1 }],
  ["monto que no es numero", { ...base, monto: "mil" }],
  ["monto infinito", { ...base, monto: Infinity }],
  ["sin fecha", { monto: 1000 }],
  ["fecha con formato de pantalla", { ...base, fecha: "30/10/2026" }],
  ["fecha vacia", { ...base, fecha: "" }],
  ["tipo inventado", { ...base, tipo: "mixto" }],
  ["metodo de pago inventado", { ...base, metodo_pago: "cheque" }],
  ["body que no es objeto", "x"],
  ["body null", null],
  ["body array", [base]],
] as const) {
  const r = alta(body);
  ok(nombre, r.ok === false && r.error.length > 0, JSON.stringify(r));
}

console.log("\nEdicion: solo toca lo que vino");
{
  const r = edicion({ monto: 500 });
  ok("un solo campo", r.ok === true && Object.keys(r.campos).length === 1, JSON.stringify(r));
  ok("no inventa tipo ni fecha", r.ok === true && r.campos.fecha === undefined && r.campos.tipo === undefined);
}
{
  const r = edicion({ metodo_pago: "" });
  ok("metodo de pago en blanco borra el dato", r.ok === true && r.campos.metodo_pago === null, JSON.stringify(r));
}
{
  const r = edicion({ beneficiario: "" });
  ok("beneficiario en blanco borra el dato", r.ok === true && r.campos.beneficiario === null, JSON.stringify(r));
}
ok("edicion vacia se rechaza", edicion({}).ok === false);
ok("edicion con campos desconocidos se rechaza", edicion({ chau: 1 }).ok === false);
ok("edicion con monto 0 se rechaza", edicion({ monto: 0 }).ok === false);
ok("edicion con fecha mal se rechaza", edicion({ fecha: "2026-13" }).ok === false);

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
