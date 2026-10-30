import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getLote,
  listEnvasado,
  listEtapas,
  listFormatosDeLote,
  updateLote,
} from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const lote = await getLote(ctx.supabase, ctx.auth.empresa_id, id);
    if (!lote) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const [etapas, envasado, formatos] = await Promise.all([
      listEtapas(ctx.supabase, id),
      listEnvasado(ctx.supabase, id),
      lote.receta_id ? listFormatosDeLote(ctx.supabase, lote.receta_id) : Promise.resolve([]),
    ]);

    return NextResponse.json(successResponse({ lote, etapas, envasado, formatos }));
  } catch (err) {
    console.error("[/api/produccion/lotes/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el lote."), { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.fermentador_id === "string" || body.fermentador_id === null) {
      patch.fermentador_id = body.fermentador_id;
    }
    if (typeof body.volumen_planificado === "number") {
      patch.volumen_planificado = body.volumen_planificado;
    }
    if (typeof body.volumen_obtenido === "number") {
      if (body.volumen_obtenido < 0) {
        return NextResponse.json(errorResponse("El volumen obtenido no puede ser negativo."), {
          status: 400,
        });
      }
      patch.volumen_obtenido = body.volumen_obtenido;
    }
    if (typeof body.fecha_fin_estimada === "string" || body.fecha_fin_estimada === null) {
      patch.fecha_fin_estimada = body.fecha_fin_estimada;
    }
    if (typeof body.observaciones === "string" || body.observaciones === null) {
      patch.observaciones = body.observaciones;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay nada que actualizar."), { status: 400 });
    }

    const lote = await updateLote(ctx.supabase, ctx.auth.empresa_id, id, patch);
    return NextResponse.json(successResponse({ lote }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/fermentador_activo_uq/i.test(msg)) {
      return NextResponse.json(errorResponse("Ese fermentador ya está ocupado."), { status: 409 });
    }
    if (/no entra en el fermentador|otra sucursal|no existe/i.test(msg)) {
      return NextResponse.json(errorResponse(msg), { status: 409 });
    }
    console.error("[/api/produccion/lotes/[id] PATCH]", msg);
    return NextResponse.json(errorResponse("No se pudo actualizar el lote."), { status: 500 });
  }
}

/**
 * DELETE /api/produccion/lotes/[id] — borra un lote que todavía no arrancó.
 *
 * SOLO EN "PLANIFICADO"
 * Desde el cocimiento, el lote tiene una producción detrás: descontó materia
 * prima y, al envasar, generó stock. Borrar la fila no deshace nada de eso —
 * dejaría los insumos consumidos sin nada que los explique y el kardex con
 * movimientos de un lote que no existe.
 *
 * Un lote ya arrancado se CANCELA (desde su pantalla), que lo saca del tablero
 * y libera el fermentador dejando el rastro de lo que pasó.
 */
export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const lote = await getLote(ctx.supabase, ctx.auth.empresa_id, id);
    if (!lote) return NextResponse.json(errorResponse("Lote no encontrado."), { status: 404 });

    if (lote.estado !== "planificado") {
      return NextResponse.json(
        errorResponse(
          `El lote ya arrancó (está en "${lote.estado}"), así que consumió materia prima y no se puede borrar. ` +
            `Cancelalo desde la pantalla del lote: libera el fermentador y deja el rastro de lo que pasó.`
        ),
        { status: 409 }
      );
    }
    // Cinturón y tirantes: si por algún camino quedó una producción asociada
    // estando en planificado, tampoco se borra.
    if (lote.produccion_id) {
      return NextResponse.json(
        errorResponse("El lote tiene una producción asociada: cancelalo en vez de borrarlo."),
        { status: 409 }
      );
    }

    // Las etapas cuelgan del lote y no tienen sentido sin él.
    await ctx.supabase.from("produccion_lote_etapas").delete().eq("lote_id", id);

    const { data, error } = await ctx.supabase
      .from("produccion_lotes")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .eq("estado", "planificado")
      .select("id");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json(
        errorResponse("El lote cambió de estado mientras lo borrabas: volvé a mirarlo."),
        { status: 409 }
      );
    }
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/produccion/lotes/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el lote."), { status: 500 });
  }
}
