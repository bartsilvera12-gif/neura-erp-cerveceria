import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { guardarItems, leerMesa } from "@/lib/mesas/server/mesas-pg";
import { agregarRonda, type ItemNuevo } from "@/lib/mesas/mesas-domain";

/**
 * POST /api/mesas/[id]/rondas — agrega una ronda a la cuenta.
 * Body: { items: [{ producto_id, cantidad, observacion? }] }
 *
 * El PRECIO y el NOMBRE salen del producto en la base, no del body: si el
 * cliente mandara el precio, cualquiera con la consola abierta se cobraría el
 * chop a 1 guaraní.
 *
 * No mueve stock. El stock baja al cobrar, cuando Caja crea la venta — igual
 * que cualquier otro pedido.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const crudos = Array.isArray(body?.items) ? (body.items as Record<string, unknown>[]) : [];
    if (crudos.length === 0) {
      return NextResponse.json(errorResponse("No hay productos para agregar."), { status: 400 });
    }

    const r = await leerMesa(sb, auth.empresa_id, sucursalId, id);
    if (!r) return NextResponse.json(errorResponse("Esa mesa no existe."), { status: 404 });
    if (r.mesa.facturacion_estado === "facturado") {
      return NextResponse.json(errorResponse("Esa mesa ya fue cobrada."), { status: 409 });
    }
    if (r.mesa.facturacion_estado === "pendiente_caja") {
      return NextResponse.json(
        errorResponse("La mesa ya está en Caja esperando cobro. Reabrila desde Caja para seguir agregando."),
        { status: 409 }
      );
    }

    const ids = [...new Set(crudos.map((c) => String(c.producto_id ?? "").trim()).filter(Boolean))];
    if (ids.length === 0) {
      return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    }

    const prod = await sb
      .from("productos")
      .select("id, nombre, sku, precio_venta")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .in("id", ids);
    if (prod.error) return NextResponse.json(errorResponse(prod.error.message), { status: 500 });

    const porId = new Map(
      ((prod.data ?? []) as Array<{ id: string; nombre: string; sku: string | null; precio_venta: unknown }>).map(
        (p) => [String(p.id), p]
      )
    );

    const nuevos: ItemNuevo[] = [];
    for (const c of crudos) {
      const pid = String(c.producto_id ?? "").trim();
      const p = porId.get(pid);
      if (!p) {
        return NextResponse.json(
          errorResponse("Hay un producto que no existe en esta sucursal."),
          { status: 400 }
        );
      }
      nuevos.push({
        producto_id: pid,
        producto_nombre: p.nombre,
        sku: p.sku,
        cantidad: Number(c.cantidad),
        precio_venta: Number(p.precio_venta) || 0,
        observacion: typeof c.observacion === "string" ? c.observacion : null,
      });
    }

    const res = agregarRonda(r.mesa.items, nuevos);
    if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: 400 });

    await guardarItems(sb, auth.empresa_id, id, r.brief, res.items);
    return NextResponse.json(successResponse({ ronda: res.ronda, items: res.items }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/[id]/rondas POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo agregar la ronda."), { status: 500 });
  }
}
