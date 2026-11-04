import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaDeUsuario } from "@/lib/auth/nombre-para-registro";
import {
  ETAPAS_ACTIVAS,
  getLote,
  insertEtapa,
  listFermentadores,
  updateLote,
} from "@/lib/produccion/lotes-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/produccion/lotes/[id]/fermentador — mueve el lote a otro tanque.
 * Body: { fermentador_id, motivo? }
 *
 * POR QUE EXISTE
 * Un lote no vive en el mismo fermentador de principio a fin: se trasvasa para
 * limpiar el tanque, para separar la levadura o porque hace falta el grande
 * para otra cocción. Antes el fermentador se elegía al crear el lote y no se
 * podía cambiar, así que la pantalla mentía sobre dónde estaba la cerveza y
 * qué tanque estaba libre.
 *
 * El cambio queda registrado en la historia del lote: de dónde salió, a dónde
 * fue y por qué. Un trasvase es una manipulación de la cerveza, no un detalle
 * administrativo — si algo sale mal después, esa fecha es lo que se mira.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const { supabase: sb, auth } = guard.ctx;
    const empresaId = auth.empresa_id;
    const sucursalId = exigirSucursal(auth);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const destinoId = String(body?.fermentador_id ?? "").trim();
    if (!destinoId) {
      return NextResponse.json(errorResponse("Elegí a qué fermentador va el lote."), { status: 400 });
    }
    const motivo =
      typeof body?.motivo === "string" && body.motivo.trim() !== "" ? body.motivo.trim() : null;

    const lote = await getLote(sb, empresaId, id);
    if (!lote) return NextResponse.json(errorResponse("Ese lote no existe."), { status: 404 });

    // Un lote cerrado o cancelado ya no está en ningún tanque: moverlo sería
    // inventar un movimiento de cerveza que no existe.
    if (!ETAPAS_ACTIVAS.includes(lote.estado) && lote.estado !== "planificado") {
      return NextResponse.json(
        errorResponse(`Un lote ${lote.estado} no está en ningún fermentador.`),
        { status: 409 }
      );
    }
    if (lote.fermentador_id === destinoId) {
      return NextResponse.json(errorResponse("El lote ya está en ese fermentador."), { status: 400 });
    }

    const fermentadores = await listFermentadores(sb, empresaId, sucursalId);
    const destino = fermentadores.find((f) => f.id === destinoId);
    if (!destino) {
      return NextResponse.json(errorResponse("Ese fermentador no existe en esta sucursal."), { status: 404 });
    }
    if (destino.activo === false) {
      return NextResponse.json(errorResponse(`${destino.codigo} está fuera de servicio.`), { status: 409 });
    }
    // Dos lotes en el mismo tanque es cerveza mezclada: no es un problema de
    // datos, es un problema de producto.
    if (destino.lote_activo_id && destino.lote_activo_id !== id) {
      return NextResponse.json(
        errorResponse(`${destino.codigo} está ocupado por el lote ${destino.lote_activo_codigo}.`),
        { status: 409 }
      );
    }

    const origen = fermentadores.find((f) => f.id === lote.fermentador_id) ?? null;
    await updateLote(sb, empresaId, id, { fermentador_id: destinoId });

    const desde = origen ? origen.codigo : "sin fermentador";
    await insertEtapa(
      sb,
      empresaId,
      id,
      lote.estado,
      { id: auth.usuarioCatalogId ?? null, nombre: firmaDeUsuario(auth) },
      `Trasvase: ${desde} → ${destino.codigo}${motivo ? ` · ${motivo}` : ""}`
    );

    return NextResponse.json(
      successResponse({ id, fermentador_id: destinoId, desde, hasta: destino.codigo })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/produccion/lotes/[id]/fermentador]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cambiar el fermentador."), { status: 500 });
  }
}
