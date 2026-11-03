/**
 * Tests del salón.
 *
 * Lo que importa: que una mesa con cuenta abierta se muestre ocupada y no
 * duplicada, que una cuenta de una mesa que ya no está en el salón no
 * desaparezca (es plata abierta), y que lo que es para llevar no se mezcle con
 * las mesas.
 *
 * Correr con: npm run test:salon
 */
import {
  armarSalon,
  claveMesa,
  resumenSalon,
  type CuentaAbierta,
  type MesaCatalogo,
} from "../src/lib/mesas/salon";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const catalogo: MesaCatalogo[] = [
  { id: "c1", nombre: "1", sector: null, orden: 1 },
  { id: "c2", nombre: "2", sector: null, orden: 2 },
  { id: "c10", nombre: "10", sector: null, orden: 10 },
];

const cuenta = (p: Partial<CuentaAbierta>): CuentaAbierta => ({
  id: "p1", mesa: "1", modalidad: "local", total: 50000, rondas: [1, 2],
  items: [{ cantidad: 2 }, { cantidad: 1 }], abierta_at: "2026-11-03T20:00:00.000Z",
  facturacion_estado: null, ...p,
});

console.log("\nMesas libres y ocupadas");
{
  const { mesas } = armarSalon(catalogo, [cuenta({ mesa: "2" })]);
  ok("están las tres mesas del salón", mesas.length === 3);
  ok("la 1 está libre", mesas[0].estado === "libre" && mesas[0].cuenta_id === null);
  ok("la 2 está ocupada", mesas[1].estado === "ocupada");
  ok("con su total", mesas[1].total === 50000);
  ok("y sus unidades", mesas[1].unidades === 3);
  ok("lleva el id de la cuenta", mesas[1].cuenta_id === "p1");
}

console.log("\nEsperando cobro");
{
  const { mesas } = armarSalon(catalogo, [cuenta({ mesa: "1", facturacion_estado: "pendiente_caja" })]);
  ok("la mesa cerrada queda en caja", mesas[0].estado === "en_caja");
}

console.log("\nNombres escritos distinto");
{
  // El catálogo existe justamente para que "mesa 1" y "1" no sean dos lugares.
  const { mesas } = armarSalon(catalogo, [cuenta({ mesa: " 1 " })]);
  ok("la cuenta cae en su mesa", mesas[0].estado === "ocupada" && mesas.length === 3);
  ok("clave sin espacios ni mayúsculas", claveMesa(" terraza  2 ") === "TERRAZA 2");
}

console.log("\nUna cuenta sin mesa en el salón");
{
  const { mesas } = armarSalon(catalogo, [cuenta({ id: "px", mesa: "PATIO" })]);
  // Esconderla sería perder de vista una cuenta con plata.
  ok("igual se muestra", mesas.length === 4);
  const patio = mesas.find((m) => m.nombre === "PATIO");
  ok("marcada como suelta", patio?.fuera_de_catalogo === true);
  ok("y al final", mesas[mesas.length - 1].nombre === "PATIO");
}

console.log("\nPara llevar");
{
  const { mesas, paraLlevar } = armarSalon(catalogo, [
    cuenta({ id: "pl", mesa: "JUAN", modalidad: "carry_out" }),
  ]);
  ok("no ensucia el salón", mesas.length === 3 && mesas.every((m) => m.estado === "libre"));
  ok("va aparte", paraLlevar.length === 1 && paraLlevar[0].nombre === "JUAN");
}

console.log("\nOrden");
{
  const { mesas } = armarSalon(catalogo, []);
  // La 10 va después de la 2, no entre la 1 y la 2.
  ok("por orden, no alfabético", mesas.map((m) => m.nombre).join(",") === "1,2,10", mesas.map((m) => m.nombre).join(","));
}

console.log("\nResumen");
{
  const { mesas } = armarSalon(catalogo, [
    cuenta({ mesa: "1", total: 30000 }),
    cuenta({ id: "p2", mesa: "2", total: 20000, facturacion_estado: "pendiente_caja" }),
  ]);
  const r = resumenSalon(mesas);
  ok("una libre", r.libres === 1);
  ok("una ocupada", r.ocupadas === 1);
  ok("una en caja", r.en_caja === 1);
  ok("suma lo abierto", r.total_abierto === 50000);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
