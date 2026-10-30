/**
 * Tests de la fecha/hora de Paraguay.
 *
 * El QA lo reporto por el ticket: venta a las 16:44, ticket a las 19:44. La
 * causa es que el servidor corre en UTC y los documentos usaban
 * `getHours()`. El caso grave no estaba en el QA: la firma de un evento SIFEN
 * salia 3 horas adelantada, y el SET la rechaza con el error 1004.
 *
 * Correr con: npm run test:fecha-py
 */
import { fechaHoraPy, fechaPy, isoLocalPy, ymdPy } from "../src/lib/fecha/paraguay";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}
const eq = (nombre: string, real: string, esperado: string) =>
  ok(nombre, real === esperado, `esperaba "${esperado}", dio "${real}"`);

console.log("\nEl caso del QA: venta 16:44, ticket decia 19:44");
// 19:44 UTC es 16:44 en Paraguay.
eq("el ticket imprime la hora del local", fechaHoraPy("2026-10-30T19:44:00Z"), "30/10/2026 16:44");

console.log("\nNo se corre el dia");
eq("01:00 UTC es del dia anterior en Paraguay",
   fechaHoraPy("2026-10-30T01:00:00Z"), "29/10/2026 22:00");
eq("y la fecha sola acompaña", fechaPy("2026-10-30T01:00:00Z"), "29/10/2026");
eq("ymd para agrupar por dia", ymdPy("2026-10-30T01:00:00Z"), "2026-10-29");

console.log("\nMedianoche: no puede salir 24:00");
eq("medianoche local", fechaHoraPy("2026-10-30T03:00:00Z"), "30/10/2026 00:00");

console.log("\nSIFEN: la firma no puede ir adelantada");
eq("dFecFirma en hora de Paraguay",
   isoLocalPy("2026-10-30T19:44:03Z"), "2026-10-30T16:44:03");
{
  // El error 1004 del SET es exactamente esto: la hora del servidor por
  // delante de la de Paraguay.
  const d = new Date("2026-10-30T19:44:03Z");
  const servidor =
    `${d.getUTCFullYear()}-10-30T` +
    `${String(d.getUTCHours()).padStart(2, "0")}:44:03`;
  ok("la firma ya NO es la hora del servidor", isoLocalPy(d) !== servidor,
     `servidor ${servidor}, firma ${isoLocalPy(d)}`);
  ok("y va atrasada respecto de UTC, nunca adelantada",
     isoLocalPy(d) < servidor, `${isoLocalPy(d)} vs ${servidor}`);
}

console.log("\nEntradas raras no rompen el documento");
eq("fecha invalida se devuelve tal cual", fechaHoraPy("no es fecha"), "no es fecha");
ok("iso de una fecha invalida es vacio", isoLocalPy("no es fecha") === "");
eq("acepta Date", fechaHoraPy(new Date("2026-01-05T15:30:00Z")), "05/01/2026 12:30");
eq("acepta epoch ms", fechaHoraPy(Date.parse("2026-01-05T15:30:00Z")), "05/01/2026 12:30");

console.log("\nEl mismo instante da el mismo texto, corra donde corra");
{
  const antes = process.env.TZ;
  const vistas = new Set<string>();
  for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "America/Asuncion"]) {
    process.env.TZ = tz;
    vistas.add(fechaHoraPy("2026-10-30T19:44:00Z"));
  }
  process.env.TZ = antes;
  ok("no depende de la zona del servidor", vistas.size === 1, [...vistas].join(" / "));
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
