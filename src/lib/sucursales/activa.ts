/**
 * Sucursal ACTIVA de la sesión.
 *
 * MODELO:
 *   · `usuario_sucursales` (N:M) dice a QUÉ sucursales puede entrar el usuario.
 *     Es la fuente de verdad del acceso.
 *   · `usuarios.sucursal_predeterminada_id` dice con CUÁL arranca la sesión.
 *   · La cookie `neura_sucursal` dice en cuál está parado AHORA.
 *
 * La mayoría de los usuarios tiene una sola sucursal y nunca ve el selector:
 * para ellos la cookie no existe y todo funciona como antes. El selector
 * aparece sólo cuando el usuario tiene acceso a más de una (p. ej. el dueño de
 * un negocio con dos administraciones).
 *
 * CONSOLIDADO: quien tiene más de una sucursal puede además elegir
 * `"consolidado"`, que suma las dos en Dashboard y Reportes. Es de SOLO
 * LECTURA: las pantallas operativas exigen una sucursal concreta, porque el
 * mismo SKU existe en las dos como filas distintas y cargar stock o facturar
 * "en las dos" no significa nada. Ver `@/lib/sucursales/filtro`.
 *
 * La cookie NO es una credencial: nunca otorga acceso por sí sola. El servidor
 * la valida contra `usuario_sucursales` en cada request y, si no está en la
 * lista, cae a la sucursal predeterminada. Por eso puede ser legible por el
 * cliente sin riesgo.
 */

/** Nombre de la cookie que lleva la sucursal activa. */
export const SUCURSAL_COOKIE = "neura_sucursal";

/**
 * Valor de la cookie para la vista consolidada.
 *
 * No es un UUID a propósito: así nunca puede colisionar con el id de una
 * sucursal real ni colarse en un filtro como si lo fuera.
 */
export const SUCURSAL_CONSOLIDADO = "consolidado";

/** Un año: la elección persiste entre sesiones; cambiarla es un clic. */
export const SUCURSAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `true` si el valor tiene forma de UUID canónico. No dice nada sobre el acceso. */
export function esUuidSucursal(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * `true` si el valor pedido es la vista consolidada, y el usuario tiene más de
 * una sucursal. Con una sola no hay nada que consolidar.
 */
export function esConsolidado(
  pedida: string | null | undefined,
  permitidas: readonly string[]
): boolean {
  return pedida === SUCURSAL_CONSOLIDADO && permitidas.length > 1;
}

/**
 * Elige la sucursal activa a partir de lo que pidió el cliente y de lo que el
 * usuario realmente tiene permitido.
 *
 * @param pedida      Valor de la cookie (puede ser basura o de otra empresa).
 * @param permitidas  Sucursales de `usuario_sucursales`. Vacío = sin N:M cargada.
 * @param porDefecto  `usuarios.sucursal_predeterminada_id`.
 *
 * Reglas:
 *   · La pedida gana sólo si está entre las permitidas.
 *   · Sin N:M cargada (instalaciones que nunca la poblaron) manda el default:
 *     no se asume acceso a nada que no esté declarado.
 *   · Si el default tampoco está entre las permitidas, se usa la primera
 *     permitida — el default quedó obsoleto y negar todo dejaría al usuario
 *     sin poder trabajar.
 */
export function resolverSucursalActiva(
  pedida: string | null | undefined,
  permitidas: readonly string[],
  porDefecto: string | null | undefined
): string | null {
  if (permitidas.length === 0) return porDefecto ?? null;
  if (esUuidSucursal(pedida) && permitidas.includes(pedida)) return pedida;
  if (porDefecto && permitidas.includes(porDefecto)) return porDefecto;
  return permitidas[0] ?? porDefecto ?? null;
}
