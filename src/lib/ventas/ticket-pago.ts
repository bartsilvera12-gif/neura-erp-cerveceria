import { METODO_PAGO_LABEL, type MetodoPago, type PagosDesglose } from "@/lib/ventas/types";
import { normalizarDesglose } from "@/lib/ventas/pago-mixto";

/**
 * Las líneas de "Pago" del ticket.
 *
 * ESTO ANTES MENTÍA. El ticket imprimía `metodo_pago` tal cual, y una venta a
 * CRÉDITO sale con `metodo_pago = 'efectivo'` (es el valor por defecto del
 * formulario: cuando la condición es Crédito ni siquiera se muestra el
 * selector de cobro). Resultado: todo ticket a crédito decía "Pago: Efectivo",
 * que es exactamente lo contrario de lo que pasó — no se cobró nada.
 *
 * Reglas:
 *   · Crédito → dice Crédito y el plazo. No hay método de cobro porque no hubo
 *     cobro.
 *   · Mixto → "Mixto" y abajo cuánto entró por cada método. "Mixto" solo no le
 *     sirve al cliente para controlar el vuelto.
 *   · Transferencia o tarjeta → el banco y la referencia si se cargaron. Es el
 *     dato con el que después se concilia.
 *
 * Es una función pura y no HTML armado a mano para poder probarla: un ticket
 * que miente sobre cómo se cobró es un problema de plata, no de formato.
 */

export type LineaPagoTicket = {
  /** Etiqueta de la izquierda. Las que empiezan con "·" son el detalle del mixto. */
  label: string;
  valor: string;
};

export type DatosPagoTicket = {
  tipo_venta: string | null | undefined;
  plazo_dias: number | null | undefined;
  metodo_pago: string | null | undefined;
  pagos_desglose: unknown;
  /** Filas de `ventas_pagos_detalle`, para el banco y la referencia. */
  detalle?: Array<{
    metodo_pago?: string | null;
    entidad_nombre_snapshot?: string | null;
    referencia?: string | null;
  }> | null;
};

function etiqueta(m: string | null | undefined): string {
  const k = String(m ?? "") as MetodoPago;
  return METODO_PAGO_LABEL[k] ?? "—";
}

/** Banco y referencia de un método, si se cargaron al cobrar. */
function datosEntidad(d: DatosPagoTicket, metodo: string): string | null {
  const fila = (d.detalle ?? []).find((f) => f?.metodo_pago === metodo);
  if (!fila) return null;
  const partes = [fila.entidad_nombre_snapshot?.trim(), fila.referencia?.trim()]
    .filter((x): x is string => !!x);
  return partes.length > 0 ? partes.join(" · ") : null;
}

export function lineasPagoTicket(
  d: DatosPagoTicket,
  formatGs: (n: number) => string
): LineaPagoTicket[] {
  if (String(d.tipo_venta ?? "").toUpperCase() === "CREDITO") {
    const plazo = Number(d.plazo_dias);
    return [
      {
        label: "Pago",
        valor: Number.isFinite(plazo) && plazo > 0 ? `Crédito a ${plazo} días` : "Crédito",
      },
    ];
  }

  const metodo = String(d.metodo_pago ?? "");

  if (metodo === "mixto") {
    const desglose: PagosDesglose = normalizarDesglose(d.pagos_desglose);
    const partes = (["efectivo", "transferencia", "tarjeta"] as const)
      .map((m) => ({ m, monto: Number(desglose[m]) || 0 }))
      .filter((x) => x.monto > 0);

    // Un "mixto" sin reparto no se puede detallar; igual se dice que fue mixto
    // en vez de inventar un método.
    if (partes.length === 0) return [{ label: "Pago", valor: "Mixto" }];

    const filas: LineaPagoTicket[] = [{ label: "Pago", valor: "Mixto" }];
    for (const p of partes) {
      filas.push({ label: `· ${etiqueta(p.m)}`, valor: formatGs(p.monto) });
      const extra = datosEntidad(d, p.m);
      if (extra) filas.push({ label: "  ", valor: extra });
    }
    return filas;
  }

  if (!metodo) return [{ label: "Pago", valor: "—" }];

  const filas: LineaPagoTicket[] = [{ label: "Pago", valor: etiqueta(metodo) }];
  const extra = datosEntidad(d, metodo);
  if (extra) filas.push({ label: "  ", valor: extra });
  return filas;
}
