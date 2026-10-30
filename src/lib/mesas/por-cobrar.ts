/**
 * Mesas por cobrar: lo que el cajero ve, en lógica pura.
 *
 * El circuito de una mesa termina en Caja: el mozo la cierra, y recién ahí se
 * cobra, se descuenta lo que falte y se emite la venta. Entre esas dos cosas la
 * mesa queda esperando, y hasta ahora no había dónde verla: aparecía en la
 * tabla genérica de "pedidos pendientes de facturación" de /ventas, mezclada
 * con presupuestos, sin mesa, sin rondas y sin saber si la cocina ya entregó.
 *
 * Esta pantalla muestra las dos cosas que el cajero necesita decidir:
 *   · las mesas CERRADAS esperando cobro, que es lo que tiene que cobrar ya;
 *   · las mesas ABIERTAS con consumo, para cuando el cliente se acerca a pagar
 *     a la caja sin que el mozo haya cerrado nada.
 *
 * Y una advertencia que sólo se puede dar acá: si quedan rondas que la cocina
 * no marcó listas, cobrar es dar por entregado algo que todavía no salió.
 */

import { estadoDeRonda } from "@/lib/comandas/comandas-domain";

export type EstadoCobro = "esperando_cobro" | "abierta";

export type ItemResumen = { producto_nombre: string; cantidad: number };

export type MesaCobro = {
  id: string;
  mesa: string;
  modalidad: string;
  estado: EstadoCobro;
  total: number;
  rondas: number;
  unidades: number;
  /** Cuándo se abrió, y cuándo se cerró si ya está esperando cobro. */
  abierta_at: string;
  cerrada_at: string | null;
  /** Desde cuándo está esperando: el cierre si está cerrada, la apertura si no. */
  espera_desde: string;
  /** Rondas que la barra o la cocina todavía no marcaron listas. */
  sin_entregar: number;
  /** "2× Chop rubia, 1× Hamburguesa +3" — para no tener que abrir la cuenta. */
  resumen: string;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Las primeras líneas de la cuenta, y cuántas quedaron afuera. Sirve para
 * reconocer la mesa de un vistazo, no para cobrar: el detalle está en la cuenta.
 */
export function resumenItems(items: ItemResumen[], max = 3): string {
  const vivos = items.filter((i) => num(i.cantidad) > 0);
  if (vivos.length === 0) return "";
  const texto = vivos
    .slice(0, max)
    .map((i) => `${num(i.cantidad)}× ${i.producto_nombre || "—"}`)
    .join(", ");
  const resto = vivos.length - max;
  return resto > 0 ? `${texto} +${resto}` : texto;
}

/** Cuántas rondas siguen sin marcarse listas. 0 significa que todo salió. */
export function rondasSinEntregar(rondas: number[], rondasEstado: unknown): number {
  return rondas.filter((r) => estadoDeRonda(rondasEstado, r) !== "listo").length;
}

export function aMesaCobro(entrada: {
  id: string;
  mesa: string;
  modalidad?: string;
  total: number;
  rondas: number[];
  items: ItemResumen[];
  abierta_at: string;
  facturacion_estado: string | null;
  metadata: Record<string, unknown>;
}): MesaCobro {
  const esperando = entrada.facturacion_estado === "pendiente_caja";
  const cerradaAt =
    typeof entrada.metadata.mesa_cerrada_at === "string" && entrada.metadata.mesa_cerrada_at
      ? entrada.metadata.mesa_cerrada_at
      : typeof entrada.metadata.enviado_a_caja_at === "string" && entrada.metadata.enviado_a_caja_at
        ? entrada.metadata.enviado_a_caja_at
        : null;
  return {
    id: entrada.id,
    mesa: entrada.mesa,
    modalidad: entrada.modalidad ?? "local",
    estado: esperando ? "esperando_cobro" : "abierta",
    total: num(entrada.total),
    rondas: entrada.rondas.length,
    unidades: entrada.items.reduce((a, i) => a + num(i.cantidad), 0),
    abierta_at: entrada.abierta_at,
    cerrada_at: esperando ? cerradaAt : null,
    espera_desde: (esperando && cerradaAt) || entrada.abierta_at,
    sin_entregar: rondasSinEntregar(entrada.rondas, entrada.metadata.rondas_estado),
    resumen: resumenItems(entrada.items),
  };
}

/**
 * Primero lo que está esperando cobro, y dentro de cada grupo lo que espera
 * hace más tiempo. Una mesa cerrada hace veinte minutos es un cliente parado
 * en la caja; una abierta es gente todavía sentada.
 */
export function ordenarCobro(mesas: MesaCobro[]): MesaCobro[] {
  const peso: Record<EstadoCobro, number> = { esperando_cobro: 0, abierta: 1 };
  return [...mesas].sort((a, b) => {
    if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado];
    return new Date(a.espera_desde).getTime() - new Date(b.espera_desde).getTime();
  });
}

/** Los números del encabezado: cuántas mesas y cuánta plata hay de cada lado. */
export function totalesCobro(mesas: MesaCobro[]): {
  esperando: number;
  abiertas: number;
  monto_esperando: number;
  monto_abierto: number;
} {
  let esperando = 0;
  let abiertas = 0;
  let montoEsperando = 0;
  let montoAbierto = 0;
  for (const m of mesas) {
    if (m.estado === "esperando_cobro") {
      esperando += 1;
      montoEsperando += m.total;
    } else {
      abiertas += 1;
      montoAbierto += m.total;
    }
  }
  return {
    esperando,
    abiertas,
    monto_esperando: montoEsperando,
    monto_abierto: montoAbierto,
  };
}
