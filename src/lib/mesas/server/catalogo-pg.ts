import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { MesaCatalogo } from "@/lib/mesas/salon";

/**
 * El catálogo de mesas del salón: las mesas que existen de verdad, cargadas
 * una vez.
 *
 * SI LA TABLA NO EXISTE TODAVIA (una instancia sin el script 29) nada se rompe:
 * `listarCatalogoMesas` devuelve `null` y las pantallas siguen funcionando como
 * antes, pidiendo el nombre de la mesa al abrir la cuenta. Es preferible a una
 * pantalla rota por un script pendiente.
 */

const COLUMNAS = "id, nombre, sector, orden, activa";

function faltaLaTabla(msg: string): boolean {
  return /relation .*mesas.* does not exist|could not find the table|PGRST205|42P01/i.test(msg);
}

export async function listarCatalogoMesas(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string
): Promise<MesaCatalogo[] | null> {
  const { data, error } = await sb
    .from("mesas")
    .select(COLUMNAS)
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("activa", true)
    .order("orden", { ascending: true })
    .limit(300);
  if (error) {
    if (faltaLaTabla(error.message)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
    id: String(m.id),
    nombre: String(m.nombre ?? ""),
    sector: m.sector == null || String(m.sector).trim() === "" ? null : String(m.sector),
    orden: Number(m.orden) || 0,
  }));
}

export async function crearMesaCatalogo(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  datos: { nombre: string; sector: string | null; orden: number }
): Promise<{ ok: true; mesa: MesaCatalogo } | { ok: false; error: string; status: number }> {
  const { data, error } = await sb
    .from("mesas")
    .insert({
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      nombre: datos.nombre,
      sector: datos.sector,
      orden: datos.orden,
      activa: true,
    })
    .select(COLUMNAS)
    .single();
  if (error) {
    if (faltaLaTabla(error.message)) {
      return { ok: false, error: "Todavía no está creada la lista de mesas en la base.", status: 409 };
    }
    if (/duplicate|unique|23505/i.test(error.message)) {
      return { ok: false, error: "Ya hay una mesa con ese nombre en esta sucursal.", status: 409 };
    }
    return { ok: false, error: error.message, status: 400 };
  }
  const m = data as Record<string, unknown>;
  return {
    ok: true,
    mesa: {
      id: String(m.id),
      nombre: String(m.nombre ?? ""),
      sector: m.sector == null ? null : String(m.sector),
      orden: Number(m.orden) || 0,
    },
  };
}

export async function actualizarMesaCatalogo(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data, error } = await sb
    .from("mesas")
    .update(patch)
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) {
      return { ok: false, error: "Ya hay una mesa con ese nombre en esta sucursal.", status: 409 };
    }
    return { ok: false, error: error.message, status: 400 };
  }
  if (!data) return { ok: false, error: "Esa mesa no existe.", status: 404 };
  return { ok: true };
}

/**
 * Borra una mesa del salón.
 *
 * Borrar la mesa NO toca las cuentas que pasaron por ella: una cuenta guarda el
 * nombre de la mesa, no un vínculo. Lo que se borra es el lugar en el plano.
 */
export async function borrarMesaCatalogo(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { error } = await sb
    .from("mesas")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message, status: 400 };
  return { ok: true };
}
