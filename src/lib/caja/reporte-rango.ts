import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";

/** YYYY-MM-DD válido, o null. */
function ymd(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Resta días a un YYYY-MM-DD sin salirse del calendario. */
function menosDias(ymdStr: string, dias: number): string {
  const d = new Date(ymdStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Normaliza los parámetros desde/hasta del reporte de caja.
 *
 * Por defecto: los últimos 30 días (zona Asunción).
 *
 * Antes arrancaba el 1° del mes actual, y eso dejaba el informe vacío cada
 * principio de mes: un 2 de noviembre sólo miraba dos días, así que los
 * turnos de octubre no aparecían y parecía que no se hubiera cerrado ninguna
 * caja nunca. Una ventana móvil siempre muestra lo último que pasó.
 *
 * Devuelve los bordes UTC para filtrar timestamptz + las etiquetas YYYY-MM-DD.
 */
export function resolverRangoCajas(
  desdeRaw: string | null | undefined,
  hastaRaw: string | null | undefined
): { start: string; end: string; desde: string; hasta: string } {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  const desde = ymd(desdeRaw) ?? menosDias(hoy, 30);
  const hasta = ymd(hastaRaw) ?? hoy;
  const { start, end } = asuncionRangeBoundsUtc(desde, hasta);
  return { start, end, desde, hasta };
}
