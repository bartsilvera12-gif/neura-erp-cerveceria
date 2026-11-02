import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listProductosDeUbicacion } from "@/lib/inventario/server/catalogos-pg";
import { exigirSucursales, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

/**
 * GET /api/inventario/ubicaciones/[id]/productos — qué hay guardado ahí.
 *
 * Los mismos productos que la lista cuenta en la columna "Productos", para que
 * el detalle cierre con el número de la fila.
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const filas = await listProductosDeUbicacion(schema, ctx.auth.empresa_id, id, {
      sucursalIds: exigirSucursales(ctx.auth),
    });
    return NextResponse.json(
      successResponse({
        productos: filas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          sku: p.sku,
          stock_actual: Number(p.stock_actual) || 0,
          costo_promedio: Number(p.costo_promedio) || 0,
          unidad_medida: p.unidad_medida,
        })),
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/inventario/ubicaciones/[id]/productos]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el contenido de la ubicación."), {
      status: 500,
    });
  }
}
