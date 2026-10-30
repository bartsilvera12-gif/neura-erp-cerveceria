import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { envasarLote, VolumenInsuficienteError } from "@/lib/produccion/envasado-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import { firmaDeUsuario } from "@/lib/auth/nombre-para-registro";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const producto_id = typeof body.producto_id === "string" ? body.producto_id : "";
    const cantidad = typeof body.cantidad === "number" ? body.cantidad : 0;

    if (!producto_id || cantidad <= 0) {
      return NextResponse.json(
        errorResponse("Formato y cantidad mayor a 0 son obligatorios."),
        { status: 400 }
      );
    }

    const r = await envasarLote({
      sb: ctx.supabase,
      empresaId: ctx.auth.empresa_id,
      loteId: id,
      productoId: producto_id,
      cantidad,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioNombre: firmaDeUsuario(ctx.auth),
    });

    return NextResponse.json(successResponse({ envasado: r }));
  } catch (err) {
    if (err instanceof VolumenInsuficienteError) {
      return NextResponse.json(errorResponse(err.message), { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Los errores de negocio de `envasarLote` ya vienen con texto para mostrar.
    if (/etapa|volumen obtenido|formato de la receta|convertir|receta/i.test(msg)) {
      return NextResponse.json(errorResponse(msg), { status: 409 });
    }
    console.error("[/api/produccion/lotes/[id]/envasado POST]", msg);
    return NextResponse.json(errorResponse("No se pudo registrar el envasado."), { status: 500 });
  }
}
