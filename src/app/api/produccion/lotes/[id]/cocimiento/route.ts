import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getLote, insertEtapa, updateLote } from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { firmaDeUsuario } from "@/lib/auth/nombre-para-registro";
import {
  crearProduccionPg,
  InsumoInsuficienteError,
} from "@/lib/produccion/crear-produccion-pg";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/produccion/lotes/[id]/cocimiento — arranca el lote.
 *
 * Consume los insumos de la receta y da de alta el producto a granel usando la
 * fabricación que ya existía: el stock y el costo siguen saliendo de un solo
 * lugar. El lote sólo guarda a qué fabricación corresponde y pasa a etapa
 * "cocimiento".
 */
export async function POST(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const volumen = typeof body.volumen_obtenido === "number" ? body.volumen_obtenido : null;
    const permitirSinStock = body.permitir_sin_stock === true;

    const lote = await getLote(ctx.supabase, ctx.auth.empresa_id, id);
    if (!lote) return NextResponse.json(errorResponse("Lote no encontrado."), { status: 404 });

    if (lote.estado !== "planificado") {
      return NextResponse.json(
        errorResponse(`El cocimiento ya se registró: el lote está en "${lote.estado}".`),
        { status: 409 }
      );
    }
    if (!lote.receta_id) {
      return NextResponse.json(
        errorResponse("El lote no tiene receta, así que no se sabe qué insumos consumir."),
        { status: 409 }
      );
    }
    if (volumen == null || volumen <= 0) {
      return NextResponse.json(
        errorResponse("Cargá los litros obtenidos en el knockout."),
        { status: 400 }
      );
    }

    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const prod = await crearProduccionPg({
      schema,
      empresaId: ctx.auth.empresa_id,
      recetaId: lote.receta_id,
      cantidadFabricar: volumen,
      observaciones: `Cocimiento del lote ${lote.codigo}`,
      permitirSinStock,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioNombre: firmaDeUsuario(ctx.auth),
    });

    const actualizado = await updateLote(ctx.supabase, ctx.auth.empresa_id, id, {
      estado: "cocimiento",
      volumen_obtenido: volumen,
      produccion_id: prod.produccion_id,
      fecha_inicio: lote.fecha_inicio ?? new Date().toISOString(),
    });

    await insertEtapa(
      ctx.supabase,
      ctx.auth.empresa_id,
      id,
      "cocimiento",
      { id: ctx.auth.usuarioCatalogId ?? null, nombre: ctx.auth.nombre ?? null },
      `Knockout: ${volumen} L`
    );

    return NextResponse.json(successResponse({ lote: actualizado, produccion: prod }));
  } catch (err) {
    if (err instanceof InsumoInsuficienteError) {
      return NextResponse.json(
        { success: false, error: err.message, faltantes: err.faltantes },
        { status: 409 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/no entra en el fermentador/i.test(msg)) {
      return NextResponse.json(errorResponse(msg), { status: 409 });
    }
    console.error("[/api/produccion/lotes/[id]/cocimiento POST]", msg);
    return NextResponse.json(errorResponse("No se pudo registrar el cocimiento."), { status: 500 });
  }
}
