/**
 * Cuenta abierta de una mesa: lógica pura, sin base ni red.
 *
 * COMO SE GUARDA
 * Una mesa abierta es un PEDIDO (`proyectos`) con sus ítems en
 * `brief_data.items`. No hay tabla nueva a propósito: ese pedido es el mismo
 * que la Caja ya sabe cobrar (`/ventas/nueva?pedido_id=…` precarga sus ítems,
 * cobra, descuenta stock y marca el pedido como facturado). Cerrar una mesa es
 * mandar ese pedido a Caja, nada más.
 *
 * RONDAS
 * Cada vez que se agregan productos a la mesa es una ronda. El ítem guarda en
 * qué ronda entró para que la comanda imprima SOLO lo nuevo: si a la ronda 3 se
 * le imprimiera todo, la cocina volvería a preparar lo de la ronda 1.
 *
 * El stock baja AL SERVIR cada ronda, no al cobrar: una mesa puede estar
 * abierta tres horas y durante toda esa noche el sistema diría que hay granel
 * que ya se sirvió. Lo hace `stock-mesa.ts`; acá sólo vive la cuenta.
 */

export type ItemMesa = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  total_linea: number;
  /** Ronda en la que se pidió. 1 es la primera. */
  ronda: number;
  /** Para este plato/trago en particular ("sin hielo"). */
  observacion?: string | null;
};

export type ItemNuevo = {
  producto_id: string;
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  precio_venta: number;
  observacion?: string | null;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normaliza lo que vino de `brief_data.items`, que es jsonb y puede traer cualquier cosa. */
export function leerItems(raw: unknown): ItemMesa[] {
  if (!Array.isArray(raw)) return [];
  const items: ItemMesa[] = [];
  for (const r of raw) {
    if (r == null || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const producto_id = typeof o.producto_id === "string" ? o.producto_id : "";
    if (!producto_id) continue;
    const cantidad = num(o.cantidad);
    const precio = num(o.precio_venta);
    items.push({
      producto_id,
      producto_nombre: typeof o.producto_nombre === "string" ? o.producto_nombre : "",
      sku: typeof o.sku === "string" ? o.sku : null,
      cantidad,
      precio_venta: precio,
      // Los ítems viejos (pedidos creados antes de las mesas) no tienen ronda:
      // se les asigna la 1 para que sigan sumando y se puedan imprimir.
      total_linea: o.total_linea != null ? num(o.total_linea) : cantidad * precio,
      ronda: Number.isInteger(o.ronda) && num(o.ronda) >= 1 ? num(o.ronda) : 1,
      observacion: typeof o.observacion === "string" && o.observacion.trim() !== "" ? o.observacion.trim() : null,
    });
  }
  return items;
}

/** La ronda que le toca a lo próximo que se agregue. */
export function siguienteRonda(items: ItemMesa[]): number {
  return items.reduce((max, i) => Math.max(max, i.ronda), 0) + 1;
}

export function itemsDeRonda(items: ItemMesa[], ronda: number): ItemMesa[] {
  return items.filter((i) => i.ronda === ronda);
}

/** Rondas existentes, de la más vieja a la más nueva. */
export function rondas(items: ItemMesa[]): number[] {
  return [...new Set(items.map((i) => i.ronda))].sort((a, b) => a - b);
}

export function totalMesa(items: ItemMesa[]): number {
  return items.reduce((a, i) => a + i.total_linea, 0);
}

export type ResultadoRonda =
  | { ok: true; items: ItemMesa[]; ronda: number }
  | { ok: false; error: string };

/**
 * Agrega una ronda a la cuenta. Devuelve la lista COMPLETA de ítems (la vieja
 * más la nueva), porque es lo que se guarda en `brief_data.items`.
 *
 * Las líneas no se fusionan con las de rondas anteriores aunque sean el mismo
 * producto: dos chops pedidos en momentos distintos son dos comandas distintas,
 * y fusionarlos haría que la segunda comanda imprimiera "2 chops" cuando sólo
 * hay que servir uno.
 */
export function agregarRonda(itemsActuales: ItemMesa[], nuevos: ItemNuevo[]): ResultadoRonda {
  if (!Array.isArray(nuevos) || nuevos.length === 0) {
    return { ok: false, error: "No hay productos para agregar." };
  }
  const ronda = siguienteRonda(itemsActuales);
  const agregados: ItemMesa[] = [];
  for (const n of nuevos) {
    const producto_id = typeof n?.producto_id === "string" ? n.producto_id.trim() : "";
    if (!producto_id) return { ok: false, error: "Hay un producto sin identificar." };
    const cantidad = num(n.cantidad);
    if (!(cantidad > 0)) {
      return { ok: false, error: `La cantidad de ${n.producto_nombre || "un producto"} debe ser mayor a 0.` };
    }
    const precio = num(n.precio_venta);
    if (precio < 0) {
      return { ok: false, error: `El precio de ${n.producto_nombre || "un producto"} no puede ser negativo.` };
    }
    agregados.push({
      producto_id,
      producto_nombre: typeof n.producto_nombre === "string" ? n.producto_nombre : "",
      sku: typeof n.sku === "string" && n.sku.trim() !== "" ? n.sku.trim() : null,
      cantidad,
      precio_venta: precio,
      total_linea: Math.round(cantidad * precio),
      ronda,
      observacion:
        typeof n.observacion === "string" && n.observacion.trim() !== "" ? n.observacion.trim() : null,
    });
  }
  return { ok: true, items: [...itemsActuales, ...agregados], ronda };
}

/**
 * Quita una línea de la cuenta. Sólo de la ÚLTIMA ronda: lo anterior ya salió
 * impreso a la cocina y pudo haberse preparado, así que sacarlo de la cuenta
 * sin avisar es regalar mercadería. Para eso está anular la mesa entera, que
 * deja rastro.
 */
export function quitarItem(
  items: ItemMesa[],
  indice: number
): { ok: true; items: ItemMesa[] } | { ok: false; error: string } {
  if (!Number.isInteger(indice) || indice < 0 || indice >= items.length) {
    return { ok: false, error: "Esa línea no existe." };
  }
  const ultima = items.reduce((max, i) => Math.max(max, i.ronda), 0);
  if (items[indice].ronda !== ultima) {
    return {
      ok: false,
      error:
        "Sólo se puede sacar algo de la última ronda: las anteriores ya salieron impresas a la cocina.",
    };
  }
  return { ok: true, items: items.filter((_, i) => i !== indice) };
}

/** Nombre de mesa normalizado: sin espacios de más, en mayúsculas. */
export function normalizarMesa(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function errorMesa(mesa: string): string | null {
  if (mesa === "") return "Poné el número o el nombre de la mesa.";
  if (mesa.length > 40) return "El nombre de la mesa es demasiado largo.";
  return null;
}
