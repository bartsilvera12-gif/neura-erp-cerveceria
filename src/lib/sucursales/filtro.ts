/**
 * Filtro por sucursal para consultas PostgREST.
 *
 * MODELO: el usuario opera en UNA sucursal a la vez y ve únicamente lo de esa
 * sucursal. Aplica a todos los roles, admin incluido.
 *
 * Quién puede entrar a cuáles lo define `usuario_sucursales`; en cuál está
 * parado ahora lo resuelve `@/lib/sucursales/activa` y llega acá ya resuelto
 * dentro de `ctx.auth`.
 *
 * VISTA CONSOLIDADA: quien tiene acceso a varias sucursales puede ponerse en
 * "Consolidado" para ver Dashboard y Reportes con las dos sumadas. Es de SOLO
 * LECTURA y sólo en esas pantallas. Operar (vender, comprar, mover stock,
 * facturar) exige una sucursal concreta: el mismo SKU existe en las dos como
 * filas distintas, y "cargar stock en las dos" no significa nada. Por eso
 * `exigirSucursal` falla en consolidado, con un mensaje que dice qué hacer.
 *
 * Un usuario SIN sucursal asignada es una MISCONFIGURACIÓN, no un caso válido.
 * Antes esto devolvía "no filtrar" para no dejar a nadie con la pantalla vacía,
 * pero bajo este modelo eso significa que un usuario mal configurado ve los
 * datos de TODAS las sucursales — una fuga es peor que una pantalla vacía.
 *
 * Ambos casos fallan de forma explícita y con un mensaje accionable, en vez de
 * degradar en silencio hacia cualquiera de los dos extremos.
 */

/**
 * Lo que estas funciones necesitan del contexto autenticado.
 *
 * Reciben el contexto entero y no sólo el id porque, sin el flag, un
 * `sucursal_id` nulo es ambiguo: puede ser un usuario mal configurado o un
 * usuario en vista consolidada, y cada caso necesita un mensaje distinto.
 */
export type AuthSucursal = {
  sucursal_id?: string | null;
  /** Sucursales a las que el usuario puede entrar. Al menos una, salvo misconfiguración. */
  sucursal_ids?: string[];
  /** `true` si el usuario eligió "Consolidado". */
  sucursal_consolidada?: boolean;
};

/** Error de configuración: el usuario no tiene sucursal asignada. */
export class SucursalNoAsignadaError extends Error {
  constructor() {
    super(
      "Tu usuario no tiene una sucursal asignada. Pedile a un administrador que te asigne una desde Usuarios."
    );
    this.name = "SucursalNoAsignadaError";
  }
}

/** El usuario está en vista consolidada y pidió algo que necesita una sucursal concreta. */
export class SucursalConsolidadaError extends Error {
  constructor() {
    super(
      "Estás en la vista consolidada, que es de sólo lectura. Elegí una sucursal en el menú de arriba para operar."
    );
    this.name = "SucursalConsolidadaError";
  }
}

/**
 * Devuelve la sucursal en la que opera el usuario, o lanza.
 * Usar en todo endpoint que lea o escriba datos de UNA sucursal.
 */
export function exigirSucursal(auth: AuthSucursal): string {
  if (auth.sucursal_id) return auth.sucursal_id;
  if (auth.sucursal_consolidada) throw new SucursalConsolidadaError();
  throw new SucursalNoAsignadaError();
}

/**
 * Devuelve las sucursales que entran en la consulta: una sola en el caso
 * normal, todas las permitidas en vista consolidada.
 *
 * Usar SOLO en endpoints de lectura que agregan (Dashboard, Reportes). Nunca
 * en los que escriben.
 */
export function exigirSucursales(auth: AuthSucursal): string[] {
  if (auth.sucursal_consolidada) {
    const ids = auth.sucursal_ids ?? [];
    if (ids.length > 0) return ids;
    throw new SucursalNoAsignadaError();
  }
  return [exigirSucursal(auth)];
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
 * Variante para varias sucursales (vista consolidada). Pasá el resultado de
 * `exigirSucursales`.
 *
 * Con una sola sucursal usa `.eq()` en vez de `.in()`: es la misma consulta que
 * se venía haciendo, así el camino normal no cambia de plan de ejecución.
 */
export function aplicarFiltroSucursales<T>(query: T, sucursalIds: readonly string[]): T {
  if (sucursalIds.length === 1) return aplicarFiltroSucursal(query, sucursalIds[0]);
  return (query as unknown as { in(column: string, values: readonly string[]): T }).in(
    "sucursal_id",
    sucursalIds
  );
}

/**
 * Traduce los errores de sucursal a una respuesta HTTP clara.
 * Devuelve `null` si el error es otro, para que el caller siga con su manejo normal.
 *
 * 409 y no 500: no es una falla del servidor sino un estado que el usuario (o
 * un administrador) puede corregir, y el mensaje se le muestra tal cual.
 */
export function respuestaSucursalNoAsignada(err: unknown): Response | null {
  if (err instanceof SucursalNoAsignadaError || err instanceof SucursalConsolidadaError) {
    return Response.json({ ok: false, error: err.message }, { status: 409 });
  }
  return null;
}
