/**
 * Prueba de `calcularConsumo` con un cliente Supabase simulado: comprueba la
 * explosión de recetas (un chop descuenta litros de granel) sin tocar la base.
 */
// `consumo-stock` lleva `server-only`, que explota fuera de Next. Para poder
// probarlo sin levantar la app se neutraliza ese import y después se carga el
// módulo de verdad.
import Module from "node:module";
const _load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  // @ts-expect-error acceso al cargador interno de Node, a propósito
  return _load.call(this, req, ...rest);
};


type Fila = Record<string, unknown>;
function fakeSb(tablas: Record<string, Fila[]>) {
  const q = (tabla: string) => {
    let filas = [...(tablas[tabla] ?? [])];
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filas = filas.filter((f) => vs.includes(f[c] as never)); return api; },
      then: (res: any) => res({ data: filas, error: null }),
    };
    return api;
  };
  return { from: q } as any;
}

let fallos = 0, corridas = 0;

async function main() {
  const { calcularConsumo, salidasDeConsumo } = await import(
    "../src/lib/inventario/server/consumo-stock"
  );
const ok = (n: string, c: boolean, d = "") => { corridas++; console.log(c ? `  ok   ${n}` : `  FALLA ${n}${d ? " — " + d : ""}`); if (!c) fallos++; };

const BASE = {
  productos: [
    { id: "chop", empresa_id: "e", sucursal_id: "s", stock_actual: 0, costo_promedio: 0, nombre: "Chop 500", sku: "CHOP", controla_stock: false, modo_receta: "preparado_al_vender", unidad_medida: "UNIDAD" },
    { id: "granel", empresa_id: "e", sucursal_id: "s", stock_actual: 100, costo_promedio: 5000, nombre: "Granel", sku: "GRANEL", controla_stock: true, modo_receta: null, unidad_medida: "L" },
    { id: "mani", empresa_id: "e", sucursal_id: "s", stock_actual: 2, costo_promedio: 100, nombre: "Maní", sku: "MANI", controla_stock: true, modo_receta: null, unidad_medida: "UNIDAD" },
  ],
  recetas: [{ id: "r1", empresa_id: "e", producto_id: "chop", activa: true, rendimiento_cantidad: 1 }],
  receta_items: [{ receta_id: "r1", insumo_producto_id: "granel", cantidad: 500, unidad_medida: "ML", merma_pct: 0 }],
};

  console.log("\nUn chop descuenta medio litro de granel");
  {
    const c = await calcularConsumo(fakeSb(BASE), "e", "s", new Map([["chop", 2]]));
    ok("explota la receta", c.insumoNeed.get("granel") === 1, JSON.stringify([...c.insumoNeed]));
    ok("el chop NO descuenta su propio stock", !salidasDeConsumo(c, new Map([["chop", 2]])).some(s => s.producto_id === "chop"));
    const sal = salidasDeConsumo(c, new Map([["chop", 2]]));
    ok("la salida es del granel", sal.length === 1 && sal[0].producto_id === "granel", JSON.stringify(sal));
    ok("sin faltantes", c.faltantes.length === 0);
  }

  console.log("\nMerma y rendimiento");
  {
    const conMerma = { ...BASE, receta_items: [{ ...BASE.receta_items[0], merma_pct: 0.1 }] };
    const c = await calcularConsumo(fakeSb(conMerma), "e", "s", new Map([["chop", 1]]));
    ok("suma la merma", c.insumoNeed.get("granel") === 0.55, String(c.insumoNeed.get("granel")));
  }
  {
    const rend2 = { ...BASE, recetas: [{ ...BASE.recetas[0], rendimiento_cantidad: 2 }] };
    const c = await calcularConsumo(fakeSb(rend2), "e", "s", new Map([["chop", 2]]));
    ok("divide por el rendimiento", c.insumoNeed.get("granel") === 0.5, String(c.insumoNeed.get("granel")));
  }

  console.log("\nFaltantes");
  {
    const c = await calcularConsumo(fakeSb(BASE), "e", "s", new Map([["mani", 5]]));
    ok("detecta que falta", c.faltantes.length === 1 && c.faltantes[0].faltante === 3, JSON.stringify(c.faltantes));
  }
  {
    const poco = { ...BASE, productos: BASE.productos.map(p => p.id === "granel" ? { ...p, stock_actual: 0.4 } : p) };
    const c = await calcularConsumo(fakeSb(poco), "e", "s", new Map([["chop", 1]]));
    ok("falta el insumo, no el producto", c.faltantes.length === 1 && c.faltantes[0].tipo === "insumo", JSON.stringify(c.faltantes));
  }

  console.log("\nproduccion_previa no explota la receta");
  {
    const prev = { ...BASE, productos: BASE.productos.map(p => p.id === "chop" ? { ...p, modo_receta: "produccion_previa", controla_stock: true, stock_actual: 10 } : p) };
    const c = await calcularConsumo(fakeSb(prev), "e", "s", new Map([["chop", 3]]));
    ok("no toca el granel", c.insumoNeed.size === 0, JSON.stringify([...c.insumoNeed]));
    const sal = salidasDeConsumo(c, new Map([["chop", 3]]));
    ok("descuenta el terminado", sal.length === 1 && sal[0].producto_id === "chop", JSON.stringify(sal));
  }

  console.log("\nUnidades incompatibles: no se descuenta nada inventado");
  {
    const raro = { ...BASE, receta_items: [{ ...BASE.receta_items[0], unidad_medida: "KG" }] };
    const c = await calcularConsumo(fakeSb(raro), "e", "s", new Map([["chop", 1]]));
    ok("no descuenta", c.insumoNeed.size === 0);
    ok("y lo reporta", c.incompatibles.length === 1, JSON.stringify(c.incompatibles));
  }

  console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
  if (fallos > 0) process.exit(1);
}

main();
