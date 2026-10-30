/**
 * Tests de la cuenta abierta de mesa (`mesas-domain`). Sin BD ni red.
 *
 * Lo que se está probando de verdad: que la comanda de una ronda imprima SOLO
 * lo de esa ronda. Si la ronda 3 imprimiera todo, la cocina volvería a preparar
 * lo de la ronda 1 y el bar regala mercadería.
 *
 * Correr con: npm run test:mesas
 */
import {
  agregarRonda,
  errorMesa,
  itemsDeRonda,
  leerItems,
  normalizarMesa,
  quitarItem,
  rondas,
  siguienteRonda,
  totalMesa,
  type ItemMesa,
} from "../src/lib/mesas/mesas-domain";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

const chop = { producto_id: "p1", producto_nombre: "Chop 500", sku: "BAR-CHOP-500", cantidad: 2, precio_venta: 25000 };
const papas = { producto_id: "p2", producto_nombre: "Papas", sku: "COM-PAPAS", cantidad: 1, precio_venta: 30000 };

console.log("\nPrimera ronda");
let items: ItemMesa[] = [];
{
  const r = agregarRonda(items, [chop, papas]);
  ok("agrega", r.ok === true, JSON.stringify(r));
  if (r.ok) {
    items = r.items;
    ok("es la ronda 1", r.ronda === 1);
    ok("calcula el total de linea", items[0].total_linea === 50000, JSON.stringify(items[0]));
    ok("total de la mesa", totalMesa(items) === 80000, String(totalMesa(items)));
  }
}

console.log("\nSegunda ronda: la comanda imprime SOLO lo nuevo");
{
  const r = agregarRonda(items, [{ ...chop, cantidad: 1 }]);
  ok("agrega", r.ok === true);
  if (r.ok) {
    items = r.items;
    ok("es la ronda 2", r.ronda === 2);
    ok("la mesa acumula", totalMesa(items) === 105000, String(totalMesa(items)));
    const comanda = itemsDeRonda(items, 2);
    ok("la comanda de la 2 trae una sola linea", comanda.length === 1, JSON.stringify(comanda));
    ok("y es la nueva", comanda[0].cantidad === 1);
    ok("la comanda de la 1 sigue intacta", itemsDeRonda(items, 1).length === 2);
    ok("rondas listadas en orden", JSON.stringify(rondas(items)) === "[1,2]");
    ok("la proxima es la 3", siguienteRonda(items) === 3);
  }
}

console.log("\nNo se fusionan lineas del mismo producto entre rondas");
{
  // Dos chops pedidos en momentos distintos son dos comandas distintas: si se
  // fusionaran, la segunda diria "3 chops" y la cocina serviria de mas.
  const delChop = items.filter((i) => i.producto_id === "p1");
  ok("quedan dos lineas de chop", delChop.length === 2, JSON.stringify(delChop));
  ok("cada una con su ronda", delChop[0].ronda === 1 && delChop[1].ronda === 2);
}

console.log("\nQuitar lineas");
{
  const ultima = items.length - 1;
  const r = quitarItem(items, ultima);
  ok("saca de la ultima ronda", r.ok === true, JSON.stringify(r));
  const r2 = quitarItem(items, 0);
  ok("NO saca de una ronda ya impresa", r2.ok === false);
  ok("y explica por que", r2.ok === false && r2.error.includes("última ronda"), JSON.stringify(r2));
  ok("indice inexistente", quitarItem(items, 99).ok === false);
}

console.log("\nDatos rotos");
{
  ok("ronda vacia se rechaza", agregarRonda(items, []).ok === false);
  ok("cantidad 0 se rechaza", agregarRonda(items, [{ ...chop, cantidad: 0 }]).ok === false);
  ok("cantidad negativa se rechaza", agregarRonda(items, [{ ...chop, cantidad: -2 }]).ok === false);
  ok("precio negativo se rechaza", agregarRonda(items, [{ ...chop, precio_venta: -1 }]).ok === false);
  ok("precio 0 se acepta (cortesia)", agregarRonda(items, [{ ...chop, precio_venta: 0 }]).ok === true);
  ok("sin producto_id se rechaza", agregarRonda(items, [{ ...chop, producto_id: "" }]).ok === false);
}

console.log("\nLeer lo que vino del jsonb");
{
  ok("no es lista", leerItems("x").length === 0);
  ok("null", leerItems(null).length === 0);
  ok("descarta basura", leerItems([{ nada: 1 }, null, "x"]).length === 0);
  const viejos = leerItems([
    { producto_id: "p9", producto_nombre: "Pedido viejo", cantidad: "2", precio_venta: "1000" },
  ]);
  ok("items sin ronda entran como ronda 1", viejos[0]?.ronda === 1, JSON.stringify(viejos));
  ok("convierte strings a numeros", viejos[0]?.cantidad === 2 && viejos[0]?.precio_venta === 1000);
  ok("calcula el total si falta", viejos[0]?.total_linea === 2000, JSON.stringify(viejos[0]));
}

console.log("\nNombre de mesa");
{
  ok("recorta y normaliza", normalizarMesa("  terraza   2 ") === "TERRAZA 2", normalizarMesa("  terraza   2 "));
  ok("vacia se rechaza", errorMesa(normalizarMesa("   ")) !== null);
  ok("larga se rechaza", errorMesa("M".repeat(41)) !== null);
  ok("normal pasa", errorMesa(normalizarMesa("7")) === null);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
