/**
 * Tests del número de comprobante y del timbrado.
 *
 * El QA: "Nro. de factura acepta cualquier cantidad de dígitos". Una factura
 * de compra con el número mal cargado no se puede cruzar después con el libro
 * de IVA ni con lo que declara el proveedor.
 *
 * Correr con: npm run test:comprobante
 */
import {
  errorNumeroComprobante,
  errorTimbrado,
  formatearNumeroComprobante,
} from "../src/lib/validacion/documentos";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}
const pasa = (n: string, v: string) => ok(n, errorNumeroComprobante(v) === null, String(errorNumeroComprobante(v)));
const falla = (n: string, v: string) => ok(n, errorNumeroComprobante(v) !== null, "lo acepto");

console.log("\nNumero de comprobante");
pasa("el formato correcto", "001-001-0000001");
pasa("vacio es opcional por defecto", "");
ok("vacio con obligatorio si falla", errorNumeroComprobante("", { obligatorio: true }) !== null);
falla("sin guiones", "0010010000001");
falla("correlativo corto", "001-001-000001");
falla("correlativo largo", "001-001-00000012");
falla("establecimiento corto", "01-001-0000001");
falla("con letras", "A01-001-0000001");
falla("todo junto sin largo", "123");
{
  const e = errorNumeroComprobante("001-001-000001") ?? "";
  ok("el mensaje dice cuantos digitos van", e.includes("12"), e);
  ok("y muestra el formato esperado", e.includes("001-001-0000001"), e);
}

console.log("\nLa mascara arma los guiones sola");
const m = (v: string) => formatearNumeroComprobante(v);
ok("3 digitos", m("001") === "001", m("001"));
ok("4 digitos abren el segundo grupo", m("0010") === "001-0", m("0010"));
ok("6 digitos", m("001001") === "001-001", m("001001"));
ok("13 de corrido quedan bien", m("0010010000001") === "001-001-0000001", m("0010010000001"));
ok("lo pegado de una factura tambien", m("001-001-0000001") === "001-001-0000001");
ok("ignora letras y espacios", m("abc 001 001 0000001") === "001-001-0000001", m("abc 001 001 0000001"));
ok("no deja pasar de 13 digitos", m("00100100000019999") === "001-001-0000001", m("00100100000019999"));
ok("lo que arma la mascara siempre valida",
   errorNumeroComprobante(m("0010010000001")) === null);

console.log("\nTimbrado: 8 digitos");
ok("8 digitos", errorTimbrado("12345678") === null);
ok("7 no alcanza", errorTimbrado("1234567") !== null);
ok("9 es demasiado", errorTimbrado("123456789") !== null);
ok("con letras no", errorTimbrado("1234567A") !== null);
ok("con guiones tampoco: no es el numero de factura",
   errorTimbrado("001-001-0000001") !== null);
ok("vacio es opcional por defecto", errorTimbrado("") === null);
ok("vacio con obligatorio falla", errorTimbrado("", { obligatorio: true }) !== null);
{
  const e = errorTimbrado("1234567") ?? "";
  ok("el mensaje dice cuantos van", e.includes("7"), e);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
