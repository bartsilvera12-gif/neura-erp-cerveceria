import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { asMetadataObject } from "@/lib/caja/facturacion";
import { conEstadoDeRonda, esEstadoComanda } from "@/lib/comandas/comandas-domain";
import { isoLocalPy } from "@/lib/fecha/paraguay";

/**
 * POST /api/comandas/estado — marca una ronda como en preparación o lista.
 * Body: { pedido_id, ronda, estado }
 *
 * El estado vive en la metadata del pedido (`rondas_estado`), no en una tabla
 * aparte: es un dato de esa ronda y de nadie más.
 *
 * Lo marca CUALQUIERA que entre a la pantalla: en la cocina no hay login por
 * persona, hay una tablet encendida. Queda registrado quién estaba con la
 * sesión abierta, que es lo que se puede saber de verdad.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const pedidoId = String(body?.pedido_id ?? "").trim();
    const ronda = Number(body?.ronda);
    const estado = body?.estado;

    if (!pedidoId) return NextResponse.json(errorResponse("Falta el pedido."), { status: 400 });
    if (!Number.isInteger(ronda) || ronda < 1) {
      return NextResponse.json(errorResponse("Ronda inválida."), { status: 400 });
    }
    if (!esEstadoComanda(estado)) {
      return NextResponse.json(
        errorResponse("El estado tiene que ser pendiente, preparando o listo."),
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("proyectos")
      .select("id, metadata")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("id", pedidoId)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) {
      return NextResponse.json(errorResponse("Esa comanda no existe en la sucursal activa."), {
        status: 404,
      });
    }

    const ahora = isoLocalPy(new Date());
    const metadata = conEstadoDeRonda(
      asMetadataObject((data as { metadata?: unknown }).metadata),
      ronda,
      estado,
      ahora,
      auth.user?.email ?? null
    );

    const upd = await sb
      .from("proyectos")
      .update({ metadata, last_activity_at: ahora })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", pedidoId);
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ pedido_id: pedidoId, ronda, estado }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/comandas/estado]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cambiar el estado."), { status: 500 });
  }
}
