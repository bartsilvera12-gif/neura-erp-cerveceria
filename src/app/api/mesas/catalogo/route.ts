import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { crearMesaCatalogo, listarCatalogoMesas } from "@/lib/mesas/server/catalogo-pg";
import { listarMesas } from "@/lib/mesas/server/mesas-pg";
import { armarSalon, resumenSalon } from "@/lib/mesas/salon";
import { errorMesa, normalizarMesa } from "@/lib/mesas/mesas-domain";

/**
 * GET /api/mesas/catalogo — el salón entero: las mesas que existen y lo que
 * está pasando en cada una.
 *
 * `sin_catalogo: true` significa que la base todavía no tiene la lista de
 * mesas (falta el script). La pantalla sigue andando como antes.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth);
    const empresaId = ctx.auth.empresa_id;

    const [catalogo, cuentas] = await Promise.all([
      listarCatalogoMesas(ctx.supabase, empresaId, sucursalId),
      listarMesas(ctx.supabase, empresaId, sucursalId),
    ]);

    const { mesas, paraLlevar } = armarSalon(catalogo ?? [], cuentas);
    return NextResponse.json(
      successResponse({
        mesas,
        para_llevar: paraLlevar,
        resumen: resumenSalon(mesas),
        sin_catalogo: catalogo === null,
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/catalogo GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el salón."), { status: 500 });
  }
}

/** POST /api/mesas/catalogo — agrega una mesa al salón. Body: { nombre, sector?, orden? } */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sucursalId = exigirSucursal(ctx.auth);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const nombre = normalizarMesa(body?.nombre);
    const problema = errorMesa(nombre);
    if (problema) return NextResponse.json(errorResponse(problema), { status: 400 });

    const sector =
      typeof body?.sector === "string" && body.sector.trim() !== "" ? body.sector.trim() : null;
    const orden = Number.isFinite(Number(body?.orden)) ? Math.floor(Number(body?.orden)) : 0;

    const res = await crearMesaCatalogo(ctx.supabase, ctx.auth.empresa_id, sucursalId, {
      nombre,
      sector,
      orden,
    });
    if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });
    return NextResponse.json(successResponse({ mesa: res.mesa }), { status: 201 });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/catalogo POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo agregar la mesa."), { status: 500 });
  }
}
