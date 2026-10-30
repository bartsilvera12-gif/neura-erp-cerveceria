/**
 * Tests de "mesas por cobrar".
 *
 * Lo que importa: que una mesa cerrada se ordene antes que una abierta (es un
 * cliente parado en la caja), que la espera se cuente desde el CIERRE y no
 * desde la apertura, y que el aviso de "falta entregar" aparezca cuando la
 * cocina no marcó todo listo — cobrar antes de eso es dar por servido algo que
 * no salió.
 *
 * Correr con: npm run test:por-cobrar
 */
import {
  aMesaCobro,
  ordenarCobro,
  resumenItems,
  rondasSinEntregar,
  totalesCobro,
  type MesaCobro,
} from "../src/lib/mesas/por-cobrar";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const items = [
  { producto_id: "p1", producto_nombre: "Chop rubia 500", cantidad: 2 },
  { producto_id: "p2", producto_nombre: "Hamburguesa", cantidad: 1 },
  { producto_id: "p3", producto_nombre: "Papas", cantidad: 1 },
  { producto_id: "p4", producto_nombre: "Agua", cantidad: 3 },
];

console.log("\nResumen de la cuenta");
{
  ok("primeras tres y el resto contado",
     resumenItems(items) === "2× Chop rubia 500, 1× Hamburguesa, 1× Papas +1", resumenItems(items));
  ok("sin resto no agrega el +", resumenItems(items.slice(0, 2)) === "2× Chop rubia 500, 1× Hamburguesa");
  ok("cuenta vacia da vacio", resumenItems([]) === "");
  ok("ignora cantidades en cero", resumenItems([{ producto_nombre: "X", cantidad: 0 }]) === "");
  ok("producto sin nombre no rompe", resumenItems([{ producto_nombre: "", cantidad: 1 }]) === "1× —");
}

console.log("\nRondas sin entregar");
{
  const estado = { "1": { estado: "listo" }, "2": { estado: "preparando" } };
  ok("la preparando y la sin marcar cuentan", rondasSinEntregar([1, 2, 3], estado) === 2);
  ok("todo listo da cero", rondasSinEntregar([1], { "1": { estado: "listo" } }) === 0);
  ok("sin estados, todas cuentan", rondasSinEntregar([1, 2], null) === 2);
  ok("mesa sin rondas da cero", rondasSinEntregar([], null) === 0);
}

const base = {
  id: "m1",
  mesa: "7",
  modalidad: "local",
  total: 150000,
  rondas: [1, 2],
  items,
  abierta_at: "2026-10-30T21:00:00.000Z",
};

console.log("\nMesa esperando cobro");
{
  const m = aMesaCobro({
    ...base,
    facturacion_estado: "pendiente_caja",
    metadata: { mesa_cerrada_at: "2026-10-30T22:30:00.000Z", rondas_estado: { "1": { estado: "listo" } } },
  });
  ok("estado esperando", m.estado === "esperando_cobro");
  ok("guarda la hora de cierre", m.cerrada_at === "2026-10-30T22:30:00.000Z");
  // Si la espera se midiera desde la apertura, una mesa que estuvo tres horas
  // sentada figuraria como la mas urgente de la caja recien cerrada.
  ok("la espera corre desde el cierre", m.espera_desde === "2026-10-30T22:30:00.000Z");
  ok("una ronda sin entregar", m.sin_entregar === 1);
  ok("unidades sumadas", m.unidades === 7, String(m.unidades));
  ok("rondas contadas", m.rondas === 2);
}

console.log("\nMesa abierta");
{
  const m = aMesaCobro({ ...base, facturacion_estado: null, metadata: {} });
  ok("estado abierta", m.estado === "abierta");
  ok("sin hora de cierre", m.cerrada_at === null);
  ok("la espera corre desde la apertura", m.espera_desde === base.abierta_at);
}
{
  // Una mesa cerrada antes de que existiera `mesa_cerrada_at`: queda el envio a caja.
  const m = aMesaCobro({
    ...base,
    facturacion_estado: "pendiente_caja",
    metadata: { enviado_a_caja_at: "2026-10-30T22:40:00.000Z" },
  });
  ok("cae en enviado_a_caja_at", m.cerrada_at === "2026-10-30T22:40:00.000Z");
}
{
  const m = aMesaCobro({ ...base, facturacion_estado: "pendiente_caja", metadata: {} });
  ok("sin ninguna de las dos, usa la apertura", m.espera_desde === base.abierta_at);
  ok("y deja cerrada_at nulo", m.cerrada_at === null);
}

console.log("\nOrden de la pantalla");
{
  const mk = (id: string, estado: "esperando_cobro" | "abierta", desde: string) =>
    ({ id, estado, espera_desde: desde }) as MesaCobro;
  const orden = ordenarCobro([
    mk("abierta-vieja", "abierta", "2026-10-30T19:00:00.000Z"),
    mk("cobro-nueva", "esperando_cobro", "2026-10-30T22:30:00.000Z"),
    mk("cobro-vieja", "esperando_cobro", "2026-10-30T22:00:00.000Z"),
    mk("abierta-nueva", "abierta", "2026-10-30T21:00:00.000Z"),
  ]).map((m) => m.id);
  ok("cerradas primero, la que espera mas arriba",
     JSON.stringify(orden) === '["cobro-vieja","cobro-nueva","abierta-vieja","abierta-nueva"]',
     JSON.stringify(orden));
}

console.log("\nTotales del encabezado");
{
  const t = totalesCobro([
    { estado: "esperando_cobro", total: 100000 } as MesaCobro,
    { estado: "esperando_cobro", total: 50000 } as MesaCobro,
    { estado: "abierta", total: 30000 } as MesaCobro,
  ]);
  ok("dos esperando", t.esperando === 2);
  ok("una abierta", t.abiertas === 1);
  ok("monto esperando", t.monto_esperando === 150000);
  ok("monto abierto", t.monto_abierto === 30000);
  const vacio = totalesCobro([]);
  ok("sin mesas, todo en cero",
     vacio.esperando === 0 && vacio.abiertas === 0 && vacio.monto_esperando === 0 && vacio.monto_abierto === 0);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
