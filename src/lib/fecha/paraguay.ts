/**
 * Fecha y hora en la zona de Paraguay, para todo lo que se imprime o se firma.
 *
 * POR QUE EXISTE
 * El servidor corre en UTC. `new Date().getHours()` devuelve la hora del
 * contenedor, no la del local, así que:
 *
 *   · Un ticket de una venta de las 16:44 se imprimía "19:44". El cliente se
 *     lleva un comprobante con una hora que no es la de la compra, y el
 *     arqueo del turno no cierra contra los tickets.
 *   · Peor: la firma de un evento SIFEN con hora UTC queda 3 horas adelantada
 *     y el SET la rechaza con el error 1004 ("La fecha y hora de la firma
 *     digital es adelantada"). `rde-xml.ts` ya lo resolvía para las facturas;
 *     `evento-cancelacion.ts` no, así que las facturas se firmaban bien y las
 *     cancelaciones mal.
 *
 * La conversión usa la zona IANA y no un `-3` fijo: si Paraguay vuelve a mover
 * la hora, lo arregla una actualización de tzdata y no un deploy.
 */

export const TZ_PARAGUAY = "America/Asuncion";

type Partes = { anio: string; mes: string; dia: string; hora: string; min: string; seg: string };

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_PARAGUAY,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  // `h23` y no `h24`: sin esto la medianoche sale "24:00" en algunos runtimes.
  hourCycle: "h23",
});

function partes(d: Date): Partes {
  const p = FORMATO.formatToParts(d);
  const dos = (t: Intl.DateTimeFormatPart["type"], largo = 2) => {
    const raw = p.find((x) => x.type === t)?.value ?? "";
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? String(n).padStart(largo, "0") : "0".repeat(largo);
  };
  return {
    anio: dos("year", 4),
    mes: dos("month"),
    dia: dos("day"),
    hora: dos("hour"),
    min: dos("minute"),
    seg: dos("second"),
  };
}

function aFecha(valor: Date | string | number): Date | null {
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `30/10/2026 16:44` — lo que va en un ticket o un PDF. */
export function fechaHoraPy(valor: Date | string | number): string {
  const d = aFecha(valor);
  if (!d) return typeof valor === "string" ? valor : "";
  const p = partes(d);
  return `${p.dia}/${p.mes}/${p.anio} ${p.hora}:${p.min}`;
}

/** `30/10/2026`, sin hora. */
export function fechaPy(valor: Date | string | number): string {
  const d = aFecha(valor);
  if (!d) return typeof valor === "string" ? valor : "";
  const p = partes(d);
  return `${p.dia}/${p.mes}/${p.anio}`;
}

/** `2026-10-30T16:44:03` — el formato sin zona que pide SIFEN. */
export function isoLocalPy(valor: Date | string | number): string {
  const d = aFecha(valor);
  if (!d) return "";
  const p = partes(d);
  return `${p.anio}-${p.mes}-${p.dia}T${p.hora}:${p.min}:${p.seg}`;
}

/** `2026-10-30` — fecha calendario de Paraguay, para comparar o agrupar por día. */
export function ymdPy(valor: Date | string | number): string {
  const d = aFecha(valor);
  if (!d) return "";
  const p = partes(d);
  return `${p.anio}-${p.mes}-${p.dia}`;
}
