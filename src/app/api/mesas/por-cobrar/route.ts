import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { listarMesasParaCobro } from "@/lib/mesas/server/mesas-pg";
import { aMesaCobro, ordenarCobro, totalesCobro } from "@/lib/mesas/por-cobrar";

/**
 * GET /api/mesas/por-cobrar — lo que la Caja tiene que cobrar del salón.
 *
 * Devuelve las mesas cerradas esperando cobro y las abiertas con consumo. Las
 * abiertas vacías no entran: no hay nada que cobrar en una mesa recién abierta,
 * y en el salón puede haber diez.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const filas = await listarMesasParaCobro(
      ctx.supabase,
      ctx.auth.empresa_id,
      exigirSucursal(ctx.auth)
    );
    const mesas = ordenarCobro(
      filas
        .filter(({ mesa }) => mesa.items.length > 0)
        .map(({ mesa, metadata }) => aMesaCobro({ ...mesa, metadata }))
    );
    return NextResponse.json(successResponse({ mesas, totales: totalesCobro(mesas) }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/por-cobrar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las mesas por cobrar."), {
      status: 500,
    });
  }
}
