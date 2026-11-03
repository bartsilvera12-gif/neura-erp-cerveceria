import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { actualizarMesaCatalogo, borrarMesaCatalogo } from "@/lib/mesas/server/catalogo-pg";
import { errorMesa, normalizarMesa } from "@/lib/mesas/mesas-domain";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/mesas/catalogo/[id] — renombrar, mover de sector o reordenar. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const patch: Record<string, unknown> = {};
    if (body?.nombre !== undefined) {
      const nombre = normalizarMesa(body.nombre);
      const problema = errorMesa(nombre);
      if (problema) return NextResponse.json(errorResponse(problema), { status: 400 });
      patch.nombre = nombre;
    }
    if (body?.sector !== undefined) {
      patch.sector =
        typeof body.sector === "string" && body.sector.trim() !== "" ? body.sector.trim() : null;
    }
    if (body?.orden !== undefined && Number.isFinite(Number(body.orden))) {
      patch.orden = Math.floor(Number(body.orden));
    }
    if (body?.activa !== undefined) patch.activa = body.activa === true;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay nada para cambiar."), { status: 400 });
    }

    const res = await actualizarMesaCatalogo(ctx.supabase, ctx.auth.empresa_id, sucursalId, id, patch);
    if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/catalogo/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cambiar la mesa."), { status: 500 });
  }
}

/**
 * DELETE /api/mesas/catalogo/[id] — saca la mesa del salón.
 *
 * No se puede borrar una mesa con la cuenta abierta: primero se cobra. Borrarla
 * dejaría una cuenta con plata sin lugar en la pantalla.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth);
    const { id } = await params;
    const res = await borrarMesaCatalogo(ctx.supabase, ctx.auth.empresa_id, sucursalId, id);
    if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/catalogo/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la mesa."), { status: 500 });
  }
}
