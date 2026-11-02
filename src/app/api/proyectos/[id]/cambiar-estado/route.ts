import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { cerrarSegmentoHistorialAbierto, insertHistorialCambioEstado } from "@/lib/proyectos/historial-actions";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) {
    return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
  }

  try {
    const body = (await request.json().catch(() => null)) as { estado_id?: string } | null;
    const nuevoEstadoId = typeof body?.estado_id === "string" ? body.estado_id.trim() : "";
    if (!nuevoEstadoId) {
      return NextResponse.json(errorResponse("estado_id obligatorio"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const { data: proyecto, error: e1 } = await sb
      .from("proyectos")
      .select("id, estado_id, titulo, metadata")
      .eq("empresa_id", empresaId)
      .eq("id", pid)
      .maybeSingle();

    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const anteriorId = (proyecto as { estado_id?: string }).estado_id ?? null;
    if (anteriorId === nuevoEstadoId) {
      const { data: full } = await sb
        .from("proyectos")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("id", pid)
        .maybeSingle();
      if (!full) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
      const enriched = await enrichProyectosRows(sb, empresaId, [full as Record<string, unknown>]);
      return NextResponse.json(successResponse(enriched[0]));
    }

    const { data: estNuevo, error: e2 } = await sb
      .from("proyecto_estados")
      .select("id, tipo_sla, es_estado_final")
      .eq("empresa_id", empresaId)
      .eq("id", nuevoEstadoId)
      .eq("activo", true)
      .maybeSingle();

    if (e2 || !estNuevo) {
      return NextResponse.json(errorResponse("Estado destino no válido"), { status: 400 });
    }

    const tipoSla = String((estNuevo as { tipo_sla?: string }).tipo_sla ?? "interno");

    /**
     * Un pedido no se da por entregado mientras la Caja no lo haya cobrado.
     *
     * Se podía arrastrar un pedido directo a "Entregado" con la cuenta todavía
     * esperando en Caja. Después nadie lo cobra: el pedido ya figura cerrado,
     * sale del tablero y la plata no entró. Pasar por los estados del medio es
     * cuestión de orden; cobrar antes de entregar es cuestión de plata, así que
     * lo que se bloquea es esto.
     *
     * Lo que ya se cobró (`facturado`) pasa sin problema, y lo que nunca fue a
     * Caja también: no todo pedido se cobra desde acá.
     */
    if ((estNuevo as { es_estado_final?: boolean }).es_estado_final === true) {
      const meta = (proyecto as { metadata?: unknown }).metadata;
      const estadoFact =
        meta && typeof meta === "object" && !Array.isArray(meta)
          ? String((meta as Record<string, unknown>).facturacion_estado ?? "")
          : "";
      if (estadoFact === "pendiente_caja") {
        return NextResponse.json(
          errorResponse(
            "Este pedido está esperando cobro en Caja. Cobralo primero: si se da por entregado ahora, sale del tablero sin que nadie cobre."
          ),
          { status: 409 }
        );
      }
    }

    await cerrarSegmentoHistorialAbierto(sb, empresaId, pid);

    const now = new Date().toISOString();
    const { error: e3 } = await sb
      .from("proyectos")
      .update({
        estado_id: nuevoEstadoId,
        ultimo_movimiento_at: now,
        last_activity_at: now,
        updated_by: auth.usuarioCatalogId,
      })
      .eq("empresa_id", empresaId)
      .eq("id", pid);

    if (e3) return NextResponse.json(errorResponse(e3.message), { status: 400 });

    await insertHistorialCambioEstado({
      sb,
      empresaId,
      proyectoId: pid,
      estadoAnteriorId: anteriorId,
      estadoNuevoId: nuevoEstadoId,
      tipoSlaSnapshot: tipoSla,
      changedBy: auth.usuarioCatalogId,
    });

    const { data: row } = await sb.from("proyectos").select("*").eq("empresa_id", empresaId).eq("id", pid);
    const first = Array.isArray(row) ? row[0] : row;
    if (!first) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const enriched = await enrichProyectosRows(sb, empresaId, [first as Record<string, unknown>]);
    return NextResponse.json(successResponse(enriched[0]));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
