/**
 * Tests del acceso al salón y a la caja.
 *
 * Lo que importa: que el mozo NO entre a la Caja. Mesas y Comandas vivían
 * dentro del módulo de Caja, así que para que el mozo pudiera abrir una mesa
 * había que darle Caja — y con eso podía cobrar, anular una venta y ver el
 * arqueo. Acá se prueba la separación en las dos direcciones.
 *
 * Correr con: npm run test:acceso-salon
 */
import { canAccessSidebarSlug, pathRequiresModuleSlug } from "../src/lib/modulos/route-slug-map";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

console.log("\nQué módulo pide cada pantalla");
{
  ok("mesas", pathRequiresModuleSlug("/ventas/mesas") === "mesas");
  ok("la cuenta de una mesa", pathRequiresModuleSlug("/ventas/mesas/abc-123") === "mesas");
  ok("comandas", pathRequiresModuleSlug("/ventas/comandas") === "mesas");
  // Cobrar es de la Caja, aunque la pantalla hable de mesas.
  ok("por cobrar es de la caja", pathRequiresModuleSlug("/ventas/por-cobrar") === "ventas");
  ok("la caja", pathRequiresModuleSlug("/ventas") === "ventas");
  ok("la venta nueva", pathRequiresModuleSlug("/ventas/nueva") === "ventas");
  ok("con query string", pathRequiresModuleSlug("/ventas/nueva?pedido_id=x") === "ventas");
}

const mozo = new Set(["mesas"]);
const cajero = new Set(["ventas"]);

console.log("\nEl mozo");
{
  ok("entra al salón", canAccessSidebarSlug("mesas", mozo, false));
  ok("NO entra a la caja", !canAccessSidebarSlug("ventas", mozo, false));
  // Lo mismo con la allowlist estricta de la instancia dedicada.
  ok("tampoco en modo estricto", !canAccessSidebarSlug("ventas", mozo, false, undefined, { strict: true }));
  ok("no hereda notas de crédito", !canAccessSidebarSlug("notas_credito", mozo, false));
}

console.log("\nEl cajero");
{
  ok("entra a la caja", canAccessSidebarSlug("ventas", cajero, false));
  // Un cajero que además levanta una mesa no tiene que quedarse afuera del salón.
  ok("también entra al salón", canAccessSidebarSlug("mesas", cajero, false));
  ok("en modo estricto necesita el módulo",
     !canAccessSidebarSlug("mesas", cajero, false, undefined, { strict: true }));
  ok("con los dos módulos, entra igual",
     canAccessSidebarSlug("mesas", new Set(["ventas", "mesas"]), false, undefined, { strict: true }));
}

console.log("\nEl admin");
{
  ok("ve todo", canAccessSidebarSlug("ventas", new Set(), true) && canAccessSidebarSlug("mesas", new Set(), true));
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
