import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursales, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { resolverRangoCajas } from "@/lib/caja/reporte-rango";
import { getReporteCierresCaja } from "@/lib/caja/reporte-caja-pg";
import { sucursalManejaCaja } from "@/lib/caja/server/caja-pg";

/** GET /api/reportes/cajas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — reporte de cierres de caja. */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
  try {
    // Informe de sólo lectura: en consolidado muestra los turnos de las dos
    // sucursales en vez de cortar con un error.
    const sucursales = exigirSucursales(ctx.auth);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = new URL(request.url).searchParams;
    const rango = resolverRangoCajas(sp.get("desde"), sp.get("hasta"));
    // Basta con que UNA de las sucursales maneje caja para que el informe
    // tenga algo que mostrar.
    const manejaPorSucursal = await Promise.all(
      sucursales.map((s) => sucursalManejaCaja(schema, ctx.auth.empresa_id, s))
    );
    const manejaCaja = manejaPorSucursal.some(Boolean);
    const reporte = await getReporteCierresCaja(schema, ctx.auth.empresa_id, sucursales, rango, manejaCaja);
    return NextResponse.json(successResponse(reporte));
  } catch (e) {
    const sr = respuestaSucursalNoAsignada(e);
    if (sr) return sr;
    console.error("[/api/reportes/cajas]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de caja."), { status: 500 });
  }
}
