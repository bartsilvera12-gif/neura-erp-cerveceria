import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { guardarItems, leerMesa } from "@/lib/mesas/server/mesas-pg";
import { quitarItem } from "@/lib/mesas/mesas-domain";
import { devolverItem } from "@/lib/mesas/server/stock-mesa";
import { marcarCanceladoDesdeCaja, marcarEnviadoACaja } from "@/lib/caja/facturacion";
import { isoLocalPy } from "@/lib/fecha/paraguay";
import { firmaDeUsuario } from "@/lib/auth/nombre-para-registro";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/mesas/[id] — la cuenta de una mesa. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const r = await leerMesa(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth), id);
    if (!r) return NextResponse.json(errorResponse("Esa mesa no existe."), { status: 404 });
    return NextResponse.json(successResponse({ mesa: r.mesa }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la mesa."), { status: 500 });
  }
}

/**
 * POST /api/mesas/[id] — acciones sobre la cuenta. Body: { accion, … }
 *
 *   · `cerrar`      → la manda a Caja. No cobra: Caja cobra, descuenta stock y
 *                     marca el pedido facturado, que es el circuito que ya
 *                     existía para los pedidos.
 *   · `reabrir`     → la saca de Caja y la devuelve al salón, para cuando la
 *                     mesa pide una vuelta más después de pedir la cuenta.
 *   · `quitar_item` → saca una línea de la última ronda (ver `mesas-domain`).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const accion = String(body?.accion ?? "").trim();

    const r = await leerMesa(sb, auth.empresa_id, sucursalId, id);
    if (!r) return NextResponse.json(errorResponse("Esa mesa no existe."), { status: 404 });
    if (r.mesa.facturacion_estado === "facturado") {
      return NextResponse.json(errorResponse("Esa mesa ya fue cobrada."), { status: 409 });
    }

    if (accion === "cerrar") {
      if (r.mesa.items.length === 0) {
        return NextResponse.json(
          errorResponse("La mesa no tiene nada cargado: no hay qué cobrar."),
          { status: 400 }
        );
      }
      if (r.mesa.facturacion_estado === "pendiente_caja") {
        // No es un error: la mesa ya está esperando en Caja y el cajero puede
        // cobrarla igual. Devolver 409 haría pensar que algo se rompió.
        return NextResponse.json(successResponse({ id, ya_estaba: true }));
      }
      const ahora = isoLocalPy(new Date());
      const upd = await sb
        .from("proyectos")
        .update({
          metadata: { ...marcarEnviadoACaja(r.metadata, ahora), mesa_cerrada_at: ahora },
          last_activity_at: ahora,
          ultimo_movimiento_at: ahora,
        })
        .eq("empresa_id", auth.empresa_id)
        .eq("id", id);
      if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });
      return NextResponse.json(successResponse({ id, ya_estaba: false }));
    }

    if (accion === "reabrir") {
      // La mesa volvió a pedir después de pedir la cuenta. Sacarla de Caja la
      // devuelve al salón y habilita rondas nuevas; no toca el stock, que ya
      // bajó al servir, ni el consumo cargado.
      if (r.mesa.facturacion_estado !== "pendiente_caja") {
        return NextResponse.json(successResponse({ id, ya_estaba: true }));
      }
      const ahora = isoLocalPy(new Date());
      const meta = marcarCanceladoDesdeCaja(r.metadata, ahora, auth.user?.email ?? null);
      const upd = await sb
        .from("proyectos")
        .update({
          metadata: { ...meta, mesa_cerrada_at: null, mesa_reabierta_at: ahora },
          last_activity_at: ahora,
          ultimo_movimiento_at: ahora,
        })
        .eq("empresa_id", auth.empresa_id)
        .eq("id", id);
      if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });
      return NextResponse.json(successResponse({ id, ya_estaba: false }));
    }

    if (accion === "quitar_item") {
      if (r.mesa.facturacion_estado === "pendiente_caja") {
        return NextResponse.json(
          errorResponse("La mesa ya está en Caja: no se puede cambiar la cuenta."),
          { status: 409 }
        );
      }
      const indice = Number(body?.indice);
      const res = quitarItem(r.mesa.items, indice);
      if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: 400 });
      // Lo que se saca de la cuenta vuelve al stock: se descontó al mandar la
      // ronda, y si no se sirve, los litros siguen en el barril.
      if (r.metadata.stock_descontado_en_mesa === true) {
        await devolverItem(sb, {
          empresaId: auth.empresa_id,
          sucursalId,
          mesa: r.mesa.mesa,
          mesaId: id,
          item: r.mesa.items[indice],
          createdBy: auth.usuarioCatalogId ?? null,
          usuarioNombre: firmaDeUsuario(auth),
        });
      }
      await guardarItems(sb, auth.empresa_id, id, r.brief, res.items);
      return NextResponse.json(successResponse({ items: res.items }));
    }

    return NextResponse.json(errorResponse("Acción desconocida."), { status: 400 });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/[id] POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo completar la acción."), { status: 500 });
  }
}
