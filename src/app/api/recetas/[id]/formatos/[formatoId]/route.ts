import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  deleteRecetaFormato,
  updateMargenObjetivo,
  updatePrecioVenta,
  updateRecetaFormato,
} from "@/lib/recetas/recetas-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

type RouteCtx = { params: Promise<{ id: string; formatoId: string }> };

const UNIDADES_CAPACIDAD = new Set(["ML", "L", "LT", "LTS", "UNIDAD", "UNID", "U"]);

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  try {
    const { formatoId } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    /**
     * El margen objetivo vive en `productos`, no en el formato, pero se edita
     * desde la receta: es donde se ve el costo contra el que se decide.
     * Se acepta en el mismo PATCH para que el usuario no tenga que ir a
     * Inventario a cambiar un número y volver.
     */
    if ("margen_objetivo_pct" in body) {
      const m = body.margen_objetivo_pct;
      const producto_id = typeof body.producto_id === "string" ? body.producto_id : null;
      if (!producto_id) {
        return NextResponse.json(
          errorResponse("Para cambiar el margen objetivo hace falta producto_id."),
          { status: 400 }
        );
      }
      if (m !== null && (typeof m !== "number" || m < 0 || m >= 1)) {
        return NextResponse.json(
          errorResponse("El margen objetivo va entre 0 y 0,99 (0,45 = 45 %)."),
          { status: 400 }
        );
      }
      await updateMargenObjetivo(
        ctx.supabase,
        ctx.auth.empresa_id,
        producto_id,
        m as number | null
      );
    }

    /** Aplicar el precio sugerido al producto del formato. */
    if ("precio_venta" in body) {
      const precio = body.precio_venta;
      const producto_id = typeof body.producto_id === "string" ? body.producto_id : null;
      if (!producto_id) {
        return NextResponse.json(
          errorResponse("Para cambiar el precio hace falta producto_id."),
          { status: 400 }
        );
      }
      if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0) {
        return NextResponse.json(errorResponse("Precio inválido."), { status: 400 });
      }
      await updatePrecioVenta(ctx.supabase, ctx.auth.empresa_id, producto_id, precio);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.capacidad === "number") {
      if (body.capacidad <= 0) {
        return NextResponse.json(errorResponse("La capacidad debe ser mayor a 0."), {
          status: 400,
        });
      }
      patch.capacidad = body.capacidad;
    }
    if (typeof body.capacidad_unidad === "string") {
      const u = body.capacidad_unidad.trim();
      if (!UNIDADES_CAPACIDAD.has(u.toUpperCase())) {
        return NextResponse.json(
          errorResponse(`Unidad de capacidad no válida: ${u}. Usá ml, L o unidad.`),
          { status: 400 }
        );
      }
      patch.capacidad_unidad = u;
    }
    if (typeof body.orden === "number") patch.orden = body.orden;

    const row = Object.keys(patch).length
      ? await updateRecetaFormato(ctx.supabase, formatoId, patch)
      : null;

    return NextResponse.json(successResponse({ formato: row, ok: true }));
  } catch (err) {
    console.error(
      "[/api/recetas/[id]/formatos/[formatoId] PATCH]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(errorResponse("No se pudo actualizar el formato."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  try {
    const { formatoId } = await params;
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    await deleteRecetaFormato(guard.ctx.supabase, formatoId);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    console.error(
      "[/api/recetas/[id]/formatos/[formatoId] DELETE]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(errorResponse("No se pudo quitar el formato."), { status: 500 });
  }
}
