import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { insertEtapa, insertLote, listLotes } from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const lotes = await listLotes(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth));
    return NextResponse.json(successResponse({ lotes }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    console.error("[/api/produccion/lotes GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los lotes."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const codigo = typeof body.codigo === "string" ? body.codigo.trim() : "";
    const receta_id = typeof body.receta_id === "string" ? body.receta_id : null;
    const producto_granel_id =
      typeof body.producto_granel_id === "string" ? body.producto_granel_id : "";

    if (!codigo || !producto_granel_id) {
      return NextResponse.json(
        errorResponse("Código de lote y producto a granel son obligatorios."),
        { status: 400 }
      );
    }

    const lote = await insertLote(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth), {
      codigo,
      receta_id,
      producto_granel_id,
      fermentador_id: typeof body.fermentador_id === "string" ? body.fermentador_id : null,
      volumen_planificado:
        typeof body.volumen_planificado === "number" ? body.volumen_planificado : null,
      fecha_fin_estimada:
        typeof body.fecha_fin_estimada === "string" && body.fecha_fin_estimada
          ? body.fecha_fin_estimada
          : null,
      responsable_usuario_id: ctx.auth.usuarioCatalogId ?? null,
      responsable_nombre:
        typeof body.responsable_nombre === "string" ? body.responsable_nombre : null,
      observaciones: typeof body.observaciones === "string" ? body.observaciones : null,
    });

    await insertEtapa(ctx.supabase, ctx.auth.empresa_id, lote.id, "planificado", {
      id: ctx.auth.usuarioCatalogId ?? null,
      nombre: typeof body.responsable_nombre === "string" ? body.responsable_nombre : null,
    });

    return NextResponse.json(successResponse({ lote }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    const msg = err instanceof Error ? err.message : String(err);
    if (/produccion_lotes_codigo_uq/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe un lote con ese código."), { status: 409 });
    }
    if (/fermentador_activo_uq/i.test(msg)) {
      return NextResponse.json(
        errorResponse("Ese fermentador ya está ocupado por otro lote."),
        { status: 409 }
      );
    }
    // Los triggers de capacidad y sucursal ya traen un mensaje para mostrar.
    if (/no entra en el fermentador|otra sucursal|no existe/i.test(msg)) {
      return NextResponse.json(errorResponse(msg), { status: 409 });
    }
    console.error("[/api/produccion/lotes POST]", msg);
    return NextResponse.json(errorResponse("No se pudo crear el lote."), { status: 500 });
  }
}
