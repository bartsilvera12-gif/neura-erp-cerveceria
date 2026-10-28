import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  ETAPAS_LOTE,
  getLote,
  insertEtapa,
  siguienteEtapa,
  updateLote,
} from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/produccion/lotes/[id]/etapa — avanza el lote a la etapa siguiente,
 * o lo cancela.
 *
 * El avance es de a una etapa: saltar dejaría el historial sin las fechas que
 * el registro de producción necesita. Cancelar sí se puede desde cualquier
 * punto, porque un lote se puede perder en cualquier momento.
 */
export async function POST(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nota = typeof body.nota === "string" ? body.nota : null;
    const cancelar = body.cancelar === true;

    const lote = await getLote(ctx.supabase, ctx.auth.empresa_id, id);
    if (!lote) return NextResponse.json(errorResponse("Lote no encontrado."), { status: 404 });

    if (lote.estado === "cerrado" || lote.estado === "cancelado") {
      return NextResponse.json(
        errorResponse(`El lote ya está ${lote.estado}; no admite más cambios de etapa.`),
        { status: 409 }
      );
    }

    const destino = cancelar ? "cancelado" : siguienteEtapa(lote.estado);
    if (!destino) {
      return NextResponse.json(
        errorResponse(`El lote está en "${lote.estado}" y no tiene etapa siguiente.`),
        { status: 409 }
      );
    }

    /**
     * Cerrar con litros sin envasar sería perder la merma en silencio: o se
     * envasa, o la diferencia queda explicada en una nota.
     */
    if (destino === "cerrado" && !nota) {
      const sinEnvasar = Number(lote.volumen_obtenido ?? 0) - Number(lote.volumen_envasado ?? 0);
      if (sinEnvasar > 0) {
        return NextResponse.json(
          errorResponse(
            `Quedan ${sinEnvasar} L sin envasar. Envasalos o explicá la merma en la nota de cierre.`
          ),
          { status: 409 }
        );
      }
    }

    const patch: Record<string, unknown> = { estado: destino };
    if (destino === "cocimiento" && !lote.fecha_inicio) {
      patch.fecha_inicio = new Date().toISOString();
    }
    if (destino === "cerrado" || destino === "cancelado") {
      patch.fecha_fin = new Date().toISOString();
    }

    const actualizado = await updateLote(ctx.supabase, ctx.auth.empresa_id, id, patch);
    await insertEtapa(
      ctx.supabase,
      ctx.auth.empresa_id,
      id,
      destino,
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? null },
      nota
    );

    return NextResponse.json(
      successResponse({ lote: actualizado, etapas_posibles: ETAPAS_LOTE })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/produccion/lotes/[id]/etapa POST]", msg);
    return NextResponse.json(errorResponse("No se pudo cambiar la etapa."), { status: 500 });
  }
}
