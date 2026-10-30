import { getCurrentUser } from "@/lib/auth";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

/**
 * Obtiene empresa_id del usuario actual.
 * @throws Error si el usuario no está autenticado o no tiene empresa asignada
 */
export async function getEmpresaId(): Promise<string> {
  const usuario = await getCurrentUser();
  const id = usuario?.empresa_id?.trim();
  if (!usuario || !id) {
    throw new Error("Usuario no autenticado o sin empresa");
  }
  return id;
}

/**
 * Devuelve un query builder de Supabase filtrado por empresa_id del usuario actual.
 * Útil para estandarizar consultas multiempresa en el ERP.
 *
 * @example
 * const { data } = await (await queryEmpresa("productos")).select("*");
 * const { data } = await (await queryEmpresa("clientes")).select("*").order("nombre");
 */
export async function queryEmpresa(tabla: string) {
  const [sb, empresaId] = await Promise.all([
    getBrowserSupabaseForEmpresaData(),
    getEmpresaId(),
  ]);
  // Tabla dinámica: Supabase tipa por nombre literal; con string el builder no expone .eq() en tipos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sb.from(tabla as any) as any).eq("empresa_id", empresaId);
}

/**
 * Sucursal ACTIVA del usuario, para las capas que escriben desde el browser en
 * vez de pasar por el contexto de auth de una ruta API.
 *
 * ANTES DEVOLVIA LA PREDETERMINADA, Y ESO PERDIA REGISTROS
 * `usuarios.sucursal_predeterminada_id` es con cuál ARRANCA la sesión, no en
 * cuál está parado el usuario ahora: eso lo dice la cookie `neura_sucursal`
 * (ver `@/lib/sucursales/activa`). Toda la lectura pasa por API y usa la
 * activa. Así que un usuario con acceso a dos sucursales — Cervecería y Bar —
 * parado en la que no es su predeterminada escribía en una y leía de la otra:
 * el gasto o el movimiento de stock se guardaba sin error y no aparecía en
 * ninguna pantalla.
 *
 * El valor se pide al servidor, que lo revalida contra `usuario_sucursales`, y
 * no se lee la cookie acá: una cookie editada a mano no alcanza para mover
 * stock a una sucursal a la que el usuario no entra.
 *
 * Lanza si falta, igual que `exigirSucursal`: sin sucursal el registro quedaría
 * huérfano y no lo vería ninguna pantalla.
 */
export async function getSucursalId(): Promise<string> {
  if (typeof window !== "undefined") {
    const res = await fetchWithSupabaseSession("/api/sucursales/activa", { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { sucursal_id?: string | null; consolidada?: boolean }
        | null;
      const activa = body?.sucursal_id?.trim();
      if (activa) return activa;
      if (body?.consolidada) {
        throw new Error(
          "Estás en la vista consolidada, que es de sólo lectura. Elegí una sucursal en el menú de arriba para operar."
        );
      }
    }
    // Si la ruta falla (red, deploy a medias) se cae al dato del usuario, que
    // es lo que se usaba antes: peor que la activa, mejor que no poder cargar.
  }

  const usuario = await getCurrentUser();
  const id = (usuario as { sucursal_predeterminada_id?: string | null } | null)
    ?.sucursal_predeterminada_id?.trim();
  if (!id) {
    throw new Error(
      "Tu usuario no tiene una sucursal asignada. Pedile a un administrador que te asigne una desde Usuarios."
    );
  }
  return id;
}
