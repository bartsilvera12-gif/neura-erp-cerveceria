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
import { revertirProduccionPg } from "@/lib/produccion/revertir-produccion-pg";

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

    /**
     * Cancelar DEVUELVE la materia prima, salvo que ya se haya envasado algo.
     *
     * Si la cocción se perdió antes de envasar, las maltas no se perdieron con
     * ella: lo correcto es que vuelvan al stock y que los litros de granel que
     * nunca llegaron a existir salgan de él. Con envases ya hechos no se
     * revierte: esas unidades pueden estar vendidas o en el bar, y devolver la
     * materia prima de algo que sí se produjo dejaría el stock inflado.
     */
    let reversa: { insumos_devueltos: number; litros_quitados: number } | null = null;
    let reversaAviso: string | null = null;
    if (destino === "cancelado" && lote.produccion_id) {
      const envasado = Number(lote.volumen_envasado ?? 0);
      if (envasado > 0) {
        reversaAviso =
          `Se cancela sin devolver la materia prima: ya se envasaron ${envasado} L, ` +
          `así que esa producción existió de verdad.`;
      } else {
        try {
          reversa = await revertirProduccionPg(ctx.supabase, {
            empresaId: ctx.auth.empresa_id,
            produccionId: lote.produccion_id,
            motivo: `Cancelación del lote ${lote.codigo}`,
            usuarioId: ctx.auth.usuarioCatalogId ?? null,
            usuarioNombre: ctx.auth.nombre ?? null,
          });
        } catch (e) {
          // La cancelación no se bloquea por esto, pero no se miente: queda
          // dicho que el stock hay que corregirlo a mano.
          console.error("[etapa] reversa de produccion fallo:", e instanceof Error ? e.message : e);
          reversaAviso =
            "El lote se canceló, pero no se pudo devolver la materia prima al stock. " +
            "Corregilo desde Inventario → Movimientos.";
        }
      }
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
      successResponse({ lote: actualizado, etapas_posibles: ETAPAS_LOTE, reversa, aviso: reversaAviso })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/produccion/lotes/[id]/etapa POST]", msg);
    return NextResponse.json(errorResponse("No se pudo cambiar la etapa."), { status: 500 });
  }
}
