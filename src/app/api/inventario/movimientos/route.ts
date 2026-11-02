import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/inventario/movimientos — lista movimientos via PostgREST (compat Hostinger sin pool PG).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;

    const { data, error } = await ctx.supabase
      .from("movimientos_inventario")
      .select(
        "id, empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, fecha, created_at, updated_at, created_by, usuario_nombre"
      )
      .eq("empresa_id", empresaId)
      .eq("sucursal_id", exigirSucursal(ctx.auth))
      .order("fecha", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const filas = (data ?? []) as Array<Record<string, unknown>>;

    /**
     * La columna "Usuario" muestra NOMBRES, nunca correos.
     *
     * Lo guardado en cada movimiento es un snapshot del momento, y ahí quedaron
     * tres cosas distintas según de dónde venía la fila: el nombre, el correo
     * crudo y filas en blanco. Eso ya no vuelve a pasar (todo se firma con el
     * nombre), pero lo viejo sigue cargado, y una columna que muestra un correo
     * en una fila y un nombre en la de abajo no se puede ni leer ni agrupar.
     *
     * Así que acá se resuelve contra el padrón de usuarios: primero por quién
     * creó la fila, y si no, por el correo que quedó guardado. Lo que no se
     * puede resolver queda como estaba.
     */
    const ids = new Set<string>();
    const correos = new Set<string>();
    for (const f of filas) {
      const id = f.created_by == null ? "" : String(f.created_by);
      if (id) ids.add(id);
      const firma = String(f.usuario_nombre ?? "").trim();
      if (firma.includes("@")) correos.add(firma.toLowerCase());
    }

    const porId = new Map<string, string>();
    const porCorreo = new Map<string, string>();
    if (ids.size > 0 || correos.size > 0) {
      const us = await ctx.supabase
        .from("usuarios")
        .select("id, nombre, email")
        .eq("empresa_id", empresaId);
      if (!us.error) {
        for (const u of (us.data ?? []) as Array<Record<string, unknown>>) {
          const nombre = String(u.nombre ?? "").trim();
          if (!nombre) continue;
          porId.set(String(u.id), nombre);
          const email = String(u.email ?? "").trim().toLowerCase();
          if (email) porCorreo.set(email, nombre);
        }
      }
    }

    const movimientos = filas.map((f) => {
      const firma = String(f.usuario_nombre ?? "").trim();
      const porCreador = f.created_by == null ? null : porId.get(String(f.created_by));
      const resuelto =
        porCreador ??
        (firma.includes("@") ? porCorreo.get(firma.toLowerCase()) ?? firma : firma);
      return {
        ...f,
        // Sin usuario guardado, la fila la hizo una carga inicial o un proceso
        // automático. Decirlo es más honesto que una celda vacía, que parece
        // un dato perdido.
        usuario_nombre: resuelto !== "" ? resuelto : "Sistema",
      };
    });

    return NextResponse.json(successResponse({ movimientos }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/movimientos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los movimientos."), { status: 500 });
  }
}
