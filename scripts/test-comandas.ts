/**
 * Tests del dominio de comandas.
 *
 * Lo que importa: que cada ronda sea UNA comanda con sólo sus ítems, que una
 * ronda sin marcar aparezca como pendiente (lo que acaba de entrar tiene que
 * verse en la cocina), y que marcar una no pise el estado de las otras.
 *
 * Correr con: npm run test:comandas
 */
import {
  comandasDePedido,
  conEstadoDeRonda,
  estadoDeRonda,
  minutosDesde,
  modalidadLabel,
  ordenarComandas,
  type Comanda,
} from "../src/lib/comandas/comandas-domain";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const mesa = {
  id: "m1",
  fechaPedido: "2026-10-30T22:00:00.000Z",
  brief: {
    mesa: "7",
    modalidad: "local",
    observacion: "Cumpleaños",
    items: [
      { producto_id: "p1", producto_nombre: "Chop 500", cantidad: 2, ronda: 1 },
      { producto_id: "p2", producto_nombre: "Papas", cantidad: 1, ronda: 1, observacion: "sin sal" },
      { producto_id: "p1", producto_nombre: "Chop 500", cantidad: 1, ronda: 2 },
    ],
  },
  metadata: {},
};

console.log("\nUna comanda por ronda");
{
  const c = comandasDePedido(mesa);
  ok("dos comandas", c.length === 2, String(c.length));
  ok("la 1 trae sus dos lineas", c[0].items.length === 2);
  // Si la ronda 2 arrastrara lo de la 1, la cocina volveria a preparar lo
  // anterior: es el error que la comanda por ronda existe para evitar.
  ok("la 2 trae SOLO lo nuevo", c[1].items.length === 1 && c[1].items[0].cantidad === 1, JSON.stringify(c[1].items));
  ok("titulo con la mesa", c[0].titulo === "Mesa 7", c[0].titulo);
  ok("arrastra la observacion del pedido", c[0].observacion === "Cumpleaños");
  ok("observacion por item", c[0].items[1].observacion === "sin sal");
  ok("id identifica la ronda", c[1].id === "m1:2", c[1].id);
}

console.log("\nSin marcar, pendiente");
{
  const c = comandasDePedido(mesa);
  ok("las dos pendientes", c.every((x) => x.estado === "pendiente"));
  ok("estado basura cae en pendiente", estadoDeRonda({ "1": { estado: "cualquiera" } }, 1) === "pendiente");
  ok("metadata vacia", estadoDeRonda(null, 1) === "pendiente");
  ok("ronda sin entrada", estadoDeRonda({ "1": { estado: "listo" } }, 2) === "pendiente");
}

console.log("\nMarcar una no pisa las otras");
{
  const meta1 = conEstadoDeRonda({}, 1, "listo", "2026-10-30T22:30:00.000Z", "Karen");
  const meta2 = conEstadoDeRonda(meta1, 2, "preparando", "2026-10-30T22:40:00.000Z", "Karen");
  ok("la 1 sigue lista", estadoDeRonda(meta2.rondas_estado, 1) === "listo");
  ok("la 2 quedo en preparacion", estadoDeRonda(meta2.rondas_estado, 2) === "preparando");
  const c = comandasDePedido({ ...mesa, metadata: meta2 });
  ok("la pantalla los refleja", c[0].estado === "listo" && c[1].estado === "preparando");
  // La metadata lleva otras cosas (stock_descontado_en_mesa, mesa_abierta):
  // marcar una comanda no puede borrarlas.
  const conOtras = conEstadoDeRonda({ mesa_abierta: true }, 1, "listo", "x", null);
  ok("no pisa el resto de la metadata", conOtras.mesa_abierta === true);
}

console.log("\nVenta de mostrador: una sola comanda");
{
  const venta = {
    id: "v1",
    fechaPedido: "2026-10-30T20:00:00.000Z",
    brief: {
      modalidad: "carry_out",
      items: [
        { producto_id: "p3", producto_nombre: "Pizza Napolitana", cantidad: 1 },
        { producto_id: "p4", producto_nombre: "Gaseosa", cantidad: 2 },
      ],
    },
    metadata: { source: "venta" },
  };
  const c = comandasDePedido(venta);
  ok("una comanda", c.length === 1);
  ok("los items sin ronda entran juntos", c[0].items.length === 2);
  ok("titulo con la modalidad", c[0].titulo === "Para llevar", c[0].titulo);
  ok("marcada como venta", c[0].de_venta === true);
  ok("delivery se traduce", modalidadLabel("delivery") === "Delivery");
}

console.log("\nDatos rotos no rompen la pantalla");
{
  ok("sin items", comandasDePedido({ id: "x", brief: {}, metadata: {}, fechaPedido: "x" }).length === 0);
  ok("items que no son lista", comandasDePedido({ id: "x", brief: { items: "no" }, metadata: {}, fechaPedido: "x" }).length === 0);
  const c = comandasDePedido({
    id: "x",
    fechaPedido: "2026-10-30T20:00:00.000Z",
    brief: { items: [{ producto_nombre: "A", cantidad: 0 }, { producto_nombre: "B", cantidad: 2 }] },
    metadata: {},
  });
  ok("cantidad 0 se descarta", c[0]?.items.length === 1 && c[0].items[0].producto_nombre === "B", JSON.stringify(c));
}

console.log("\nOrden de la pantalla");
{
  const base = (id: string, estado: Comanda["estado"], fecha: string): Comanda => ({
    id, pedido_id: id, ronda: 1, titulo: id, mesa: null, modalidad: "local",
    fecha, estado, items: [], observacion: null, de_venta: false,
  });
  const orden = ordenarComandas([
    base("listo-viejo", "listo", "2026-10-30T20:00:00.000Z"),
    base("pend-nueva", "pendiente", "2026-10-30T22:00:00.000Z"),
    base("pend-vieja", "pendiente", "2026-10-30T21:00:00.000Z"),
    base("preparando", "preparando", "2026-10-30T19:00:00.000Z"),
  ]).map((c) => c.id);
  // Lo que espera hace mas tiempo va arriba; lo listo, al final.
  ok("pendientes primero, la mas vieja arriba",
     JSON.stringify(orden) === '["pend-vieja","pend-nueva","preparando","listo-viejo"]', JSON.stringify(orden));
}

console.log("\nAntigüedad");
{
  const ahora = new Date("2026-10-30T22:35:00.000Z").getTime();
  ok("35 minutos", minutosDesde("2026-10-30T22:00:00.000Z", ahora) === 35);
  ok("recien entrada", minutosDesde("2026-10-30T22:35:00.000Z", ahora) === 0);
  ok("fecha futura no da negativo", minutosDesde("2026-10-30T23:00:00.000Z", ahora) === 0);
  ok("fecha basura", minutosDesde("x", ahora) === 0);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
