import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { resolverDestinoPedido } from "@/lib/proyectos/server/destino-pedido";
import { listarMesas, filaAMesa } from "@/lib/mesas/server/mesas-pg";
import { errorMesa, normalizarMesa } from "@/lib/mesas/mesas-domain";
import { isoLocalPy } from "@/lib/fecha/paraguay";

/**
 * GET /api/mesas — mesas abiertas del salón (y las cerradas esperando cobro).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const mesas = await listarMesas(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth));
    return NextResponse.json(successResponse({ mesas }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las mesas."), { status: 500 });
  }
}

/**
 * POST /api/mesas — abre una mesa. Body: { mesa, observacion? }
 *
 * La mesa abierta es un pedido vacío: no mueve stock ni plata. Eso recién pasa
 * al cobrar.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const mesa = normalizarMesa(body?.mesa);
    const err = errorMesa(mesa);
    if (err) return NextResponse.json(errorResponse(err), { status: 400 });

    // Dos cuentas abiertas para la misma mesa terminan en que se cobra una y la
    // otra queda viva toda la noche.
    const abiertas = await listarMesas(sb, auth.empresa_id, sucursalId);
    if (abiertas.some((m) => m.mesa === mesa && m.facturacion_estado === null)) {
      return NextResponse.json(
        errorResponse(`La mesa ${mesa} ya tiene una cuenta abierta.`),
        { status: 409 }
      );
    }

    const { tipoId, estadoId } = await resolverDestinoPedido(sb, auth.empresa_id);
    const ahora = isoLocalPy(new Date());
    const observacion =
      typeof body?.observacion === "string" && body.observacion.trim() !== ""
        ? body.observacion.trim()
        : null;

    const ins = await sb
      .from("proyectos")
      .insert({
        empresa_id: auth.empresa_id,
        sucursal_id: sucursalId,
        tipo_id: tipoId,
        estado_id: estadoId,
        titulo: `Mesa ${mesa}`.slice(0, 200),
        prioridad: "normal",
        monto_vendido: 0,
        fecha_ingreso: ahora,
        brief_data: { modalidad: "local", mesa, observacion, items: [] },
        metadata: { source: "mesa", mesa_abierta: true, mesa_abierta_at: ahora },
      })
      .select("id, titulo, brief_data, metadata, fecha_ingreso, created_at")
      .single();
    if (ins.error) return NextResponse.json(errorResponse(ins.error.message), { status: 400 });

    return NextResponse.json(
      successResponse({ mesa: filaAMesa(ins.data as Parameters<typeof filaAMesa>[0]) }),
      { status: 201 }
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas POST]", err instanceof Error ? err.message : err);
    const msg = err instanceof Error ? err.message : "No se pudo abrir la mesa.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
