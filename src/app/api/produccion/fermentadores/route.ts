import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { insertFermentador, listFermentadores } from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const fermentadores = await listFermentadores(
      ctx.supabase,
      ctx.auth.empresa_id,
      exigirSucursal(ctx.auth)
    );
    return NextResponse.json(successResponse({ fermentadores }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    console.error("[/api/produccion/fermentadores GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los fermentadores."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Alta de equipamiento: mismo permiso que editar recetas (admin/supervisor).
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const codigo = typeof body.codigo === "string" ? body.codigo.trim() : "";
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    const capacidad = typeof body.capacidad_litros === "number" ? body.capacidad_litros : 0;

    if (!codigo || !nombre || capacidad <= 0) {
      return NextResponse.json(
        errorResponse("Código, nombre y capacidad en litros son obligatorios."),
        { status: 400 }
      );
    }

    const row = await insertFermentador(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth), {
      codigo,
      nombre,
      capacidad_litros: capacidad,
      notas: typeof body.notas === "string" ? body.notas : null,
    });
    return NextResponse.json(successResponse({ fermentador: row }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    const msg = err instanceof Error ? err.message : String(err);
    if (/fermentadores_codigo_uq|duplicate/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un fermentador con ese código."), { status: 409 });
    }
    console.error("[/api/produccion/fermentadores POST]", msg);
    return NextResponse.json(errorResponse("No se pudo crear el fermentador."), { status: 500 });
  }
}
