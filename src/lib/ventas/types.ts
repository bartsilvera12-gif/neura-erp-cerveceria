export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
/**
 * Cómo se cobró la venta.
 *
 * `mixto` significa que el cobro se repartió entre dos o más de los otros tres;
 * el reparto va en `Venta.pagos_desglose` y es obligatorio. Sin el reparto, la
 * parte en efectivo no entraría al arqueo y la caja no cerraría.
 */
export type MetodoPago  = "efectivo" | "tarjeta" | "transferencia" | "mixto";

/** Los métodos concretos entre los que se puede repartir un cobro mixto. */
export type MetodoPagoSimple = Exclude<MetodoPago, "mixto">;

export const METODOS_PAGO_SIMPLES: readonly MetodoPagoSimple[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
] as const;

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta/Débito",
  mixto: "Mixto",
};

/**
 * Reparto de un cobro mixto, en guaraníes y por método. Los métodos que no se
 * usaron pueden venir en 0 o directamente ausentes.
 *
 * La suma tiene que dar el total de la venta: lo valida la app al registrar, y
 * es lo que hace que el arqueo de caja cuadre.
 */
export type PagosDesglose = Partial<Record<MetodoPagoSimple, number>>;

/** Suma del reparto, tolerante a claves ausentes o basura. */
export function totalDesglose(d: PagosDesglose | null | undefined): number {
  if (!d) return 0;
  return METODOS_PAGO_SIMPLES.reduce((acc, m) => {
    const n = Number(d[m]);
    return acc + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

/** Solo los métodos con monto > 0, en el orden en que se muestran. */
export function desgloseUsado(
  d: PagosDesglose | null | undefined
): Array<{ metodo: MetodoPagoSimple; monto: number }> {
  if (!d) return [];
  return METODOS_PAGO_SIMPLES.map((m) => ({ metodo: m, monto: Number(d[m]) || 0 })).filter(
    (x) => x.monto > 0
  );
}
export type EstadoVenta = "pendiente" | "completada" | "anulada";
/** Nivel de precio elegido para la línea de venta.
 *  'costo' se conserva SOLO como histórico (ventas viejas); ya no se ofrece en la UI. */
export type TipoPrecioVenta = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  cantidad:              number;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS
  tipo_iva:              TipoIvaVenta;
  /** Nivel de precio aplicado: minorista (precio_venta) | mayorista (precio_mayorista) | costo (costo_promedio). */
  tipo_precio?:          TipoPrecioVenta;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  metodo_pago?: MetodoPago;

  /**
   * Reparto del cobro cuando `metodo_pago === "mixto"`. `null` en el resto.
   *
   * Vive en la venta (no solo en `ventas_pagos_detalle`) a propósito: el
   * detalle de conciliación se escribe después de la venta y en best-effort,
   * y el arqueo de caja no puede depender de eso. Un detalle que no se grabó
   * haría cerrar la caja con menos plata de la que hay en el cajón.
   */
  pagos_desglose?: PagosDesglose | null;

  /** La venta emite nota de remisión (documento no fiscal). */
  genera_nota_remision?: boolean;
  /** Número de nota de remisión (NR-XXXXXX) si genera_nota_remision. */
  nota_remision_numero?: string | null;

  fecha: string;             // ISO string, generado automáticamente

  estado?: EstadoVenta;
  anulada_at?: string | null;
  anulacion_motivo?: string | null;

  /** Cliente asociado a la venta. null cuando la venta fue a consumidor final sin ficha. */
  cliente_id?: string | null;
  /** Nombre para mostrar en listados de Caja (prioriza nombre_facturacion → empresa
   *  → nombre_contacto → nombre). null cuando no hay cliente. */
  cliente_nombre?: string | null;
  /** Factura ERP asociada (puente venta→factura). null si la venta no emitió factura. */
  factura_id?: string | null;
  numero_factura?: string | null;
  /** Estado SIFEN de la factura electrónica: borrador | generado | firmado |
   *  enviado | en_proceso | aprobado | rechazado | error_envio | cancelado.
   *  El UI usa este dato para permitir anular la venta cuando el DE nunca
   *  llegó a SET (estados no-aceptados). null si no hay factura. */
  factura_estado_sifen?: string | null;
}
