import {
  METODOS_PAGO_SIMPLES,
  METODO_PAGO_LABEL,
  totalDesglose,
  type MetodoPagoSimple,
  type PagosDesglose,
} from "@/lib/ventas/types";

/**
 * Validación del reparto de un cobro mixto, compartida por la pantalla de venta
 * y la ruta que la registra.
 *
 * Está en un módulo propio y no en cada lado porque las dos validaciones tienen
 * que decir lo mismo: si la pantalla deja pasar un reparto que el servidor
 * rechaza, el cajero ve un error genérico después de cobrarle al cliente; si el
 * servidor es más laxo, entra una venta cuyo efectivo no cuadra con la caja.
 */

/**
 * Tolerancia en guaraníes. El total de la venta sale de sumar líneas con IVA
 * incluido, así que puede tener decimales; el cajero reparte en números
 * redondos. Dos guaraníes es el mismo margen que usa la validación de totales
 * de la venta (`TOL` en create-venta-pg), para que no haya un reparto que una
 * acepte y la otra no.
 */
export const TOLERANCIA_DESGLOSE = 2;

/** Deja el reparto en números limpios: descarta claves raras y negativos. */
export function normalizarDesglose(raw: unknown): PagosDesglose {
  const out: PagosDesglose = {};
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const m of METODOS_PAGO_SIMPLES) {
    const n = Number(obj[m]);
    if (Number.isFinite(n) && n > 0) out[m] = n;
  }
  return out;
}

/**
 * Primer problema del reparto, o `null` si sirve.
 *
 * `total` es el total de la venta en guaraníes.
 */
export function errorDesglose(
  desglose: PagosDesglose | null | undefined,
  total: number
): string | null {
  const d = normalizarDesglose(desglose);
  const usados = METODOS_PAGO_SIMPLES.filter((m) => (d[m] ?? 0) > 0);

  if (usados.length === 0) {
    return "Indicá cuánto se cobró en cada método.";
  }
  /**
   * Un "mixto" con un solo método no es mixto: guardarlo así escondería el
   * método real en el desglose, y los reportes que agrupan por método dirían
   * "mixto" para una venta que fue toda en efectivo.
   */
  if (usados.length === 1) {
    return `Si todo se cobró en ${METODO_PAGO_LABEL[usados[0]]}, elegí ese método en vez de Mixto.`;
  }

  const suma = totalDesglose(d);
  const dif = Math.round((suma - total) * 100) / 100;
  if (Math.abs(dif) > TOLERANCIA_DESGLOSE) {
    const fmt = (n: number) => `Gs. ${Math.round(Math.abs(n)).toLocaleString("es-PY")}`;
    return dif > 0
      ? `El reparto suma ${fmt(suma)} y la venta es de ${fmt(total)}: sobran ${fmt(dif)}.`
      : `El reparto suma ${fmt(suma)} y la venta es de ${fmt(total)}: faltan ${fmt(dif)}.`;
  }
  return null;
}

/**
 * Resuelve el método que se guarda en la venta a partir de lo que eligió el
 * cajero. Un "mixto" cuyo reparto terminó en un solo método se guarda como ese
 * método, para que los reportes por método no mientan.
 */
export function metodoEfectivoDeVenta(
  metodoElegido: string,
  desglose: PagosDesglose | null | undefined
): { metodo: "efectivo" | "transferencia" | "tarjeta" | "mixto"; desglose: PagosDesglose | null } {
  if (metodoElegido !== "mixto") {
    const m = (METODOS_PAGO_SIMPLES as readonly string[]).includes(metodoElegido)
      ? (metodoElegido as MetodoPagoSimple)
      : "efectivo";
    return { metodo: m, desglose: null };
  }
  const d = normalizarDesglose(desglose);
  const usados = METODOS_PAGO_SIMPLES.filter((m) => (d[m] ?? 0) > 0);
  if (usados.length === 1) return { metodo: usados[0], desglose: null };
  return { metodo: "mixto", desglose: d };
}
