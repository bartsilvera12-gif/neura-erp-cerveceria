import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getLote } from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import { validarMedicion } from "@/lib/produccion/densidad";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mediciones de fermentación de un lote: densidad, temperatura y pH.
 *
 * Son del LOTE y no de la etapa: una fermentación se mide varias veces por
 * etapa y a veces entre etapas. Cada medición guarda en qué etapa estaba el
 * lote, copiada, para que siga diciendo la verdad cuando el lote avance.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("produccion_mediciones")
      .select("id, fecha, etapa, densidad, temperatura, ph, nota, usuario_nombre")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("lote_id", id)
      .order("fecha", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ mediciones: data ?? [] }));
  } catch (err) {
    console.error("[/api/produccion/lotes/[id]/mediciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las mediciones."), { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const lote = await getLote(ctx.supabase, ctx.auth.empresa_id, id);
    if (!lote) return NextResponse.json(errorResponse("Lote no encontrado."), { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validarMedicion(body);
    if (!v.ok) return NextResponse.json(errorResponse(v.error), { status: 400 });

    const nota = typeof body.nota === "string" && body.nota.trim() !== "" ? body.nota.trim() : null;

    const { data, error } = await ctx.supabase
      .from("produccion_mediciones")
      .insert({
        empresa_id: ctx.auth.empresa_id,
        lote_id: id,
        etapa: lote.estado,
        densidad: v.medicion.densidad,
        temperatura: v.medicion.temperatura,
        ph: v.medicion.ph,
        nota,
        usuario_id: ctx.auth.usuarioCatalogId ?? null,
        usuario_nombre: ctx.auth.nombre ?? null,
      })
      .select("id, fecha, etapa, densidad, temperatura, ph, nota, usuario_nombre")
      .single();
    if (error) {
      // La tabla la crea el script 23: decirlo es más útil que un error de PostgREST.
      if (/produccion_mediciones/.test(error.message) && /schema cache|does not exist/i.test(error.message)) {
        return NextResponse.json(
          errorResponse("Falta la tabla de mediciones: correr el script 23 (23_mediciones_lote.sql)."),
          { status: 503 }
        );
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ medicion: data }), { status: 201 });
  } catch (err) {
    console.error("[/api/produccion/lotes/[id]/mediciones POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la medición."), { status: 500 });
  }
}

/** DELETE ?medicion=<id> — borra una medición mal cargada. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const medicionId = (new URL(request.url).searchParams.get("medicion") ?? "").trim();
    if (!medicionId) {
      return NextResponse.json(errorResponse("Falta la medición a borrar."), { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("produccion_mediciones")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("lote_id", id)
      .eq("id", medicionId)
      .select("id");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json(errorResponse("Esa medición no existe en este lote."), { status: 404 });
    }
    return NextResponse.json(successResponse({ id: medicionId }));
  } catch (err) {
    console.error("[/api/produccion/lotes/[id]/mediciones DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar la medición."), { status: 500 });
  }
}
