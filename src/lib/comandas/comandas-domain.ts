/**
 * Comandas: lo que la barra y la cocina tienen que preparar ahora.
 *
 * DE DONDE SALEN
 * No hay una tabla de comandas. Una comanda ES una ronda de una mesa abierta, o
 * el pedido que deja una venta cobrada en el mostrador. Los ítems ya están
 * guardados ahí; duplicarlos en otra tabla sería tener dos versiones de lo
 * mismo y descubrir tarde cuál miente.
 *
 * Lo único que la pantalla agrega es el ESTADO de cada ronda, que se guarda en
 * la metadata del pedido como `rondas_estado: { "2": { estado, at, por } }`.
 *
 * Sin marca, una ronda está pendiente: lo que acaba de entrar tiene que
 * aparecer en la pantalla de la cocina sin que nadie lo prepare antes.
 */

export const ESTADOS_COMANDA = ["pendiente", "preparando", "listo"] as const;
export type EstadoComanda = (typeof ESTADOS_COMANDA)[number];

export const ESTADO_LABEL: Record<EstadoComanda, string> = {
  pendiente: "Pendiente",
  preparando: "En preparación",
  listo: "Listo",
};

export type ItemComanda = {
  producto_nombre: string;
  cantidad: number;
  observacion?: string | null;
};

export type Comanda = {
  /** `<pedido_id>:<ronda>`: identifica la ronda sin inventar otra tabla. */
  id: string;
  pedido_id: string;
  ronda: number;
  /** Mesa, o la modalidad cuando no hay mesa (para llevar, delivery). */
  titulo: string;
  mesa: string | null;
  modalidad: string;
  /** Cuándo entró la ronda. Es lo que ordena la pantalla. */
  fecha: string;
  estado: EstadoComanda;
  items: ItemComanda[];
  observacion: string | null;
  /** Viene de una venta ya cobrada (mostrador) y no de una mesa abierta. */
  de_venta: boolean;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function esEstadoComanda(v: unknown): v is EstadoComanda {
  return typeof v === "string" && (ESTADOS_COMANDA as readonly string[]).includes(v);
}

/** El estado guardado para una ronda, o `pendiente` si nadie la tocó. */
export function estadoDeRonda(rondasEstado: unknown, ronda: number): EstadoComanda {
  if (rondasEstado == null || typeof rondasEstado !== "object") return "pendiente";
  const entrada = (rondasEstado as Record<string, unknown>)[String(ronda)];
  if (entrada == null || typeof entrada !== "object") return "pendiente";
  const estado = (entrada as { estado?: unknown }).estado;
  return esEstadoComanda(estado) ? estado : "pendiente";
}

/** Metadata con el estado de una ronda actualizado, sin pisar las demás. */
export function conEstadoDeRonda(
  metadata: Record<string, unknown>,
  ronda: number,
  estado: EstadoComanda,
  ahoraIso: string,
  por: string | null
): Record<string, unknown> {
  const previo =
    metadata.rondas_estado != null && typeof metadata.rondas_estado === "object"
      ? (metadata.rondas_estado as Record<string, unknown>)
      : {};
  return {
    ...metadata,
    rondas_estado: { ...previo, [String(ronda)]: { estado, at: ahoraIso, por } },
  };
}

const MODALIDAD_LABEL: Record<string, string> = {
  local: "Salón",
  carry_out: "Para llevar",
  delivery: "Delivery",
};

export function modalidadLabel(m: unknown): string {
  const k = String(m ?? "local");
  return MODALIDAD_LABEL[k] ?? k;
}

/**
 * Arma las comandas de un pedido: una por ronda.
 *
 * Los ítems sin `ronda` (los de una venta de mostrador, que no tiene rondas)
 * entran como ronda 1: es una sola comanda con todo lo que se pidió.
 */
export function comandasDePedido(p: {
  id: string;
  brief: Record<string, unknown>;
  metadata: Record<string, unknown>;
  fechaPedido: string;
}): Comanda[] {
  const itemsRaw = Array.isArray(p.brief.items) ? (p.brief.items as Record<string, unknown>[]) : [];
  if (itemsRaw.length === 0) return [];

  const mesa = typeof p.brief.mesa === "string" && p.brief.mesa.trim() !== "" ? p.brief.mesa : null;
  const modalidad = String(p.brief.modalidad ?? "local");
  const observacion =
    typeof p.brief.observacion === "string" && p.brief.observacion.trim() !== ""
      ? p.brief.observacion.trim()
      : null;
  const deVenta = p.metadata.source === "venta";

  const porRonda = new Map<number, ItemComanda[]>();
  for (const it of itemsRaw) {
    const cantidad = num(it.cantidad);
    if (cantidad <= 0) continue;
    const ronda = Number.isInteger(it.ronda) && num(it.ronda) >= 1 ? num(it.ronda) : 1;
    const lista = porRonda.get(ronda) ?? [];
    lista.push({
      producto_nombre: typeof it.producto_nombre === "string" ? it.producto_nombre : "",
      cantidad,
      observacion:
        typeof it.observacion === "string" && it.observacion.trim() !== ""
          ? it.observacion.trim()
          : null,
    });
    porRonda.set(ronda, lista);
  }

  const fechasRonda =
    p.metadata.rondas_at != null && typeof p.metadata.rondas_at === "object"
      ? (p.metadata.rondas_at as Record<string, unknown>)
      : {};

  return [...porRonda.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ronda, items]) => {
      const fechaRonda = fechasRonda[String(ronda)];
      return {
        id: `${p.id}:${ronda}`,
        pedido_id: p.id,
        ronda,
        titulo: mesa ? `Mesa ${mesa}` : modalidadLabel(modalidad),
        mesa,
        modalidad,
        fecha: typeof fechaRonda === "string" && fechaRonda ? fechaRonda : p.fechaPedido,
        estado: estadoDeRonda(p.metadata.rondas_estado, ronda),
        items,
        observacion,
        de_venta: deVenta,
      };
    });
}

/** Minutos desde que entró la comanda. Es lo que mira la cocina para priorizar. */
export function minutosDesde(iso: string, ahora = Date.now()): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora - t) / 60000));
}

/**
 * Orden de la pantalla: primero lo que está esperando hace más tiempo, y lo
 * listo al final. Una comanda vieja sin preparar es el problema que la
 * pantalla existe para mostrar.
 */
export function ordenarComandas(comandas: Comanda[]): Comanda[] {
  const peso: Record<EstadoComanda, number> = { pendiente: 0, preparando: 1, listo: 2 };
  return [...comandas].sort((a, b) => {
    if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado];
    return new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
  });
}
