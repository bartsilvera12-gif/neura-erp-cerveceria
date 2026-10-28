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
