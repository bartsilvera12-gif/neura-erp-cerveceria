import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { normalizarGastoInput } from "@/lib/gastos/payload";

/**
 * GET /api/gastos[?desde=AAAA-MM-DD&hasta=AAAA-MM-DD]
 * Gastos operativos del tenant (service role).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;

    // Rango opcional, para que el Dashboard pida sólo el mes en vez de traer
    // todo el historial y recortarlo en el browser.
    const sp = request.nextUrl.searchParams;
    const desde = (sp.get("desde") ?? "").trim();
    const hasta = (sp.get("hasta") ?? "").trim();
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    if ((desde && !YMD.test(desde)) || (hasta && !YMD.test(hasta))) {
      return NextResponse.json(errorResponse("Las fechas van en formato AAAA-MM-DD."), {
        status: 400,
      });
    }

    let q = supabase
      .from("gastos")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", exigirSucursal(auth));
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    const { data, error } = await q.order("fecha", { ascending: false });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data ?? []));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/gastos
 * Crea un gasto en la SUCURSAL ACTIVA de la sesión.
 *
 * POR QUE PASA POR ACA Y NO POR EL CLIENTE
 * Antes `createGasto` escribía directo con el cliente del browser y resolvía la
 * sucursal con `usuarios.sucursal_predeterminada_id`, mientras que este GET la
 * resuelve con la sucursal ACTIVA (la cookie `neura_sucursal`). Para un usuario
 * con acceso a dos sucursales — Cervecería y Bar — eso significaba que el gasto
 * se guardaba en una y se listaba desde la otra: se creaba bien y no aparecía
 * nunca. Con la escritura acá, el alta y la lista leen la misma sucursal.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const sucursal_id = exigirSucursal(auth);

    const body = await request.json().catch(() => null);
    const norm = normalizarGastoInput(body, { parcial: false });
    if (!norm.ok) {
      return NextResponse.json(errorResponse(norm.error), { status: 400 });
    }

    const { data, error } = await supabase
      .from("gastos")
      .insert({ ...norm.campos, empresa_id: auth.empresa_id, sucursal_id })
      .select()
      .single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data), { status: 201 });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[POST /api/gastos]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo crear el gasto."), { status: 500 });
  }
}
