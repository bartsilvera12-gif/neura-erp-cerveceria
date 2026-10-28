import type { User } from "@supabase/supabase-js";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { resolveApiAuthContext } from "@/lib/middleware/api-auth-context";

export interface UsuarioConEmpresa {
  user: User;
  empresa_id: string;
  /** PK `usuarios.id` del schema del tenant cuando se resolvió la fila. */
  usuarioCatalogId?: string | null;
  /**
   * Sucursal activa. `null` = no filtrar (comportamiento previo a multi-sucursal)
   * o vista consolidada, que se distingue por `sucursal_consolidada`.
   * Para aplicarla usá `exigirSucursal` + `aplicarFiltroSucursal`.
   */
  sucursal_id?: string | null;
  /**
   * Sucursales que entran en una lectura: la activa, o todas las permitidas en
   * vista consolidada. Para aplicarlas usá `exigirSucursales` +
   * `aplicarFiltroSucursales`, sólo en endpoints que agregan.
   */
  sucursal_ids?: string[];
  /** `true` en vista consolidada: Dashboard y Reportes suman, operar no se puede. */
  sucursal_consolidada?: boolean;
}

export interface UsuarioConEmpresaYRol extends UsuarioConEmpresa {
  rol?: string;
  nombre?: string;
}

function esRolAdmin(rol?: string): boolean {
  return esRolAdminEmpresaOGlobal(rol);
}

/**
 * Obtiene el usuario autenticado, empresa_id y rol (para validación admin).
 * Usa JWT + RLS (sin depender de SUPABASE_SERVICE_ROLE_KEY).
 */
export async function getAuthWithRol(request?: Request | null): Promise<UsuarioConEmpresaYRol | null> {
  const r = await resolveApiAuthContext(request);
  if (!r.ok || !r.ctx.empresa_id) return null;

  return {
    user: r.ctx.user,
    empresa_id: r.ctx.empresa_id,
    usuarioCatalogId: r.ctx.usuarioCatalogId ?? null,
    sucursal_id: r.ctx.sucursal_id ?? null,
    sucursal_ids: r.ctx.sucursal_ids ?? [],
    sucursal_consolidada: r.ctx.sucursal_consolidada ?? false,
    rol: r.ctx.usuarioRol ?? undefined,
    nombre: r.ctx.usuarioNombre ?? undefined,
  };
}

export function isAdmin(auth: UsuarioConEmpresaYRol | null): boolean {
  return !!auth && esRolAdmin(auth.rol);
}

/**
 * Obtiene el usuario autenticado y su empresa_id.
 * Requerido para rutas API multiempresa. Misma resolución de catálogo que `getAuthWithRol` / `resolveApiAuthContext`.
 * Para `empresa_id` + `data_schema` + cliente RLS en un solo paso, usá `resolveUsuarioEmpresaContextFromAuth`.
 */
export async function getUserAndEmpresa(request?: Request | null): Promise<UsuarioConEmpresa | null> {
  const r = await resolveApiAuthContext(request);
  if (!r.ok || !r.ctx.empresa_id) return null;
  return {
    user: r.ctx.user,
    empresa_id: r.ctx.empresa_id,
    usuarioCatalogId: r.ctx.usuarioCatalogId ?? null,
    sucursal_id: r.ctx.sucursal_id ?? null,
    sucursal_ids: r.ctx.sucursal_ids ?? [],
    sucursal_consolidada: r.ctx.sucursal_consolidada ?? false,
  };
}
