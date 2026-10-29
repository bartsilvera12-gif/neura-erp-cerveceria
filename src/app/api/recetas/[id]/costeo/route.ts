import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReceta, getRecetaCosteo } from "@/lib/recetas/recetas-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import {
  getParametrosCosteo,
  guardarParametrosCosteo,
  listCostosOperacion,
  listFormatosEnvasado,
  guardarFormatosEnvasado,
  reemplazarCostosOperacion,
  type PatchFormatoEnvasado,
} from "@/lib/recetas/costeo-pg";
import { costearReceta, type LineaOperacion } from "@/lib/recetas/costeo-completo";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET — devuelve el costeo YA CALCULADO, más los datos crudos para editarlos.
 *
 * El cálculo se hace en el servidor y no en el navegador a propósito: si lo
 * hiciera el cliente, un informe o un export tendrían que repetir la fórmula y
 * el mismo lote podría costar distinto según desde dónde se mire.
 */
export async function GET(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const receta = await getReceta(ctx.supabase, ctx.auth.empresa_id, id);
    if (!receta) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const [costeoInsumos, operacion, formatos, parametros] = await Promise.all([
      getRecetaCosteo(ctx.supabase, id),
      listCostosOperacion(ctx.supabase, id),
      listFormatosEnvasado(ctx.supabase, id),
      getParametrosCosteo(ctx.supabase, ctx.auth.empresa_id),
    ]);

    const resultado = costearReceta({
      costo_insumos_gs: Number(costeoInsumos?.costo_total ?? 0),
      rendimiento: Number(receta.rendimiento_cantidad ?? 0),
      merma_proceso_pct: Number(costeoInsumos?.merma_proceso_pct ?? 0),
      operacion,
      formatos,
      parametros,
    });

    return NextResponse.json(
      successResponse({ receta, resultado, operacion, formatos, parametros })
    );
  } catch (err) {
    console.error("[/api/recetas/[id]/costeo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo calcular el costeo."), { status: 500 });
  }
}

/**
 * PUT — guarda los tres bloques editables y devuelve el costeo recalculado,
 * para que la pantalla no tenga que pedirlo de nuevo ni recalcularlo sola.
 */
export async function PUT(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const receta = await getReceta(ctx.supabase, ctx.auth.empresa_id, id);
    if (!receta) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      operacion?: LineaOperacion[];
      formatos?: PatchFormatoEnvasado[];
      parametros?: { tarifa_mo_hora_gs?: number; margen_mayorista_pct?: number; margen_directo_pct?: number };
    };

    if (Array.isArray(body.operacion)) {
      await reemplazarCostosOperacion(ctx.supabase, ctx.auth.empresa_id, id, body.operacion);
    }
    if (Array.isArray(body.formatos)) {
      await guardarFormatosEnvasado(ctx.supabase, id, body.formatos);
    }
    if (body.parametros) {
      const actual = await getParametrosCosteo(ctx.supabase, ctx.auth.empresa_id);
      const p = body.parametros;
      // Un margen >= 1 daria precio infinito y la base lo rechaza; se acota acá
      // para devolver un error entendible en vez de un fallo de constraint.
      const margen = (v: unknown, porDefecto: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n < 1 ? n : porDefecto;
      };
      await guardarParametrosCosteo(ctx.supabase, ctx.auth.empresa_id, {
        tarifa_mo_hora_gs: Math.max(0, Number(p.tarifa_mo_hora_gs ?? actual.tarifa_mo_hora_gs) || 0),
        margen_mayorista_pct: margen(p.margen_mayorista_pct, actual.margen_mayorista_pct),
        margen_directo_pct: margen(p.margen_directo_pct, actual.margen_directo_pct),
      });
    }

    const [costeoInsumos, operacion, formatos, parametros] = await Promise.all([
      getRecetaCosteo(ctx.supabase, id),
      listCostosOperacion(ctx.supabase, id),
      listFormatosEnvasado(ctx.supabase, id),
      getParametrosCosteo(ctx.supabase, ctx.auth.empresa_id),
    ]);
    const resultado = costearReceta({
      costo_insumos_gs: Number(costeoInsumos?.costo_total ?? 0),
      rendimiento: Number(receta.rendimiento_cantidad ?? 0),
      merma_proceso_pct: Number(costeoInsumos?.merma_proceso_pct ?? 0),
      operacion,
      formatos,
      parametros,
    });

    return NextResponse.json(
      successResponse({ receta, resultado, operacion, formatos, parametros })
    );
  } catch (err) {
    console.error("[/api/recetas/[id]/costeo PUT]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar el costeo."), { status: 500 });
  }
}
