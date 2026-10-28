/**
 * Filtro por sucursal para consultas PostgREST.
 *
 * MODELO: el usuario opera en UNA sucursal a la vez y ve únicamente lo de esa
 * sucursal. Aplica a todos los roles, admin incluido. No existe vista
 * consolidada: las pantallas nunca mezclan dos sucursales.
 *
 * Quién puede entrar a cuáles lo define `usuario_sucursales`; en cuál está
 * parado ahora lo resuelve `@/lib/sucursales/activa` y llega acá ya resuelto
 * como `ctx.auth.sucursal_id`. Para este filtro no cambia nada: siempre recibe
 * una sola sucursal.
 *
 * Un usuario SIN sucursal asignada es una MISCONFIGURACIÓN, no un caso válido.
 * Antes esto devolvía "no filtrar" para no dejar a nadie con la pantalla vacía,
 * pero bajo este modelo eso significa que un usuario mal configurado ve los
 * datos de TODAS las sucursales — una fuga es peor que una pantalla vacía.
 *
 * Ahora `exigirSucursal` falla de forma explícita y con un mensaje accionable,
 * en vez de degradar en silencio hacia cualquiera de los dos extremos.
 */

/** Error de configuración: el usuario no tiene sucursal asignada. */
export class SucursalNoAsignadaError extends Error {
  constructor() {
    super(
      "Tu usuario no tiene una sucursal asignada. Pedile a un administrador que te asigne una desde Usuarios."
    );
    this.name = "SucursalNoAsignadaError";
  }
}

/**
 * Devuelve la sucursal del usuario o lanza si no tiene.
 * Usar en todo endpoint que lea o escriba datos de una sucursal.
 */
export function exigirSucursal(sucursalId: string | null | undefined): string {
  if (!sucursalId) throw new SucursalNoAsignadaError();
  return sucursalId;
}

/**
 * Aplica el filtro de sucursal. Requiere una sucursal válida: pasá el resultado
 * de `exigirSucursal`.
 *
 * `T` va sin restricción estructural a propósito: atarlo a `{ eq(...): T }` hace
 * que TypeScript intente expandir los tipos encadenados de PostgREST y falle con
 * "Type instantiation is excessively deep". El cast interno es seguro porque
 * todos los builders de PostgREST exponen `.eq()`.
 */
export function aplicarFiltroSucursal<T>(query: T, sucursalId: string): T {
  return (query as unknown as { eq(column: string, value: string): T }).eq(
    "sucursal_id",
    sucursalId
  );
}

/**
 * Traduce `SucursalNoAsignadaError` a una respuesta HTTP clara.
 * Devuelve `null` si el error es otro, para que el caller siga con su manejo normal.
 *
 * 409 y no 500: no es una falla del servidor sino un dato faltante que un
 * administrador puede corregir, y el mensaje se le muestra tal cual al usuario.
 */
export function respuestaSucursalNoAsignada(err: unknown): Response | null {
  if (!(err instanceof SucursalNoAsignadaError)) return null;
  return Response.json({ ok: false, error: err.message }, { status: 409 });
}
