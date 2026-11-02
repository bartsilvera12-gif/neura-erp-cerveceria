import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { firmaDeUsuario } from "@/lib/auth/nombre-para-registro";
import {
  devolverItemsDeVenta,
  leerVentaParaDevolver,
} from "@/lib/ventas/server/devolucion-venta-pg";
import { totalDevuelto } from "@/lib/ventas/devolucion-domain";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { registrarMovimientoCaja, resolverCajaParaVenta } from "@/lib/caja/server/caja-pg";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/ventas/[id]/devolucion — qué se puede traer de vuelta de esta venta.
 *
 * Devuelve cada línea con lo vendido, lo que ya se devolvió antes y lo que
 * queda. La pantalla no calcula nada de eso: si lo hiciera, dos pantallas
 * abiertas podrían ofrecer devolver el mismo chop dos veces.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const venta = await leerVentaParaDevolver(ctx.supabase, ctx.auth.empresa_id, id);
    if (!venta) return NextResponse.json(errorResponse("Esa venta no existe."), { status: 404 });
    return NextResponse.json(
      successResponse({
        venta: {
          id: venta.id,
          numero_control: venta.numero_control,
          estado: venta.estado,
          tipo_venta: venta.tipo_venta,
          fecha: venta.fecha,
        },
        lineas: venta.lineas,
        total_devuelto: totalDevuelto(venta.lineas),
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/ventas/[id]/devolucion GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la venta."), { status: 500 });
  }
}

/**
 * POST /api/ventas/[id]/devolucion — registra la devolución.
 * Body: { items: [{ producto_id, cantidad }], motivo? }
 *
 * El stock vuelve y queda el movimiento atado a la venta. La venta NO se
 * anula: pasó, se cobró y sigue contando en el arqueo del día. La plata que se
 * le devuelve al cliente se saca de la caja como un egreso aparte, para que el
 * cierre del turno la muestre en vez de que el efectivo "no cierre" sin motivo.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const sucursalId = exigirSucursal(ctx.auth);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const crudos = Array.isArray(body?.items) ? (body.items as Record<string, unknown>[]) : [];
    const items = crudos.map((c) => ({
      producto_id: String(c.producto_id ?? "").trim(),
      cantidad: Number(c.cantidad),
    }));
    const motivo =
      typeof body?.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;

    const venta = await leerVentaParaDevolver(ctx.supabase, ctx.auth.empresa_id, id);
    if (!venta) return NextResponse.json(errorResponse("Esa venta no existe."), { status: 404 });

    const res = await devolverItemsDeVenta({
      sb: ctx.supabase,
      empresaId: ctx.auth.empresa_id,
      sucursalId,
      ventaId: id,
      items,
      motivo,
      createdBy: ctx.auth.usuarioCatalogId ?? null,
      usuarioNombre: firmaDeUsuario(ctx.auth),
    });
    if (!res.ok) return NextResponse.json(errorResponse(res.error), { status: res.status });

    /**
     * La plata sale de la caja como un egreso.
     *
     * Sin esto, al cierre del turno falta efectivo y nada lo explica: el
     * cajero tendría que acordarse de cargar el egreso a mano, y si se olvida
     * la diferencia aparece como un faltante.
     *
     * Si no hay caja abierta no se inventa un movimiento: la devolución queda
     * registrada igual y la respuesta avisa que la plata hay que sacarla a
     * mano cuando se abra la caja. Una venta a crédito no mueve efectivo:
     * ahí lo devuelto ya se descontó de lo que el cliente debe.
     */
    let caja: "registrada" | "sin_caja" | "credito" = "credito";
    if (venta.tipo_venta !== "CREDITO" && res.monto > 0) {
      caja = "sin_caja";
      try {
        const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
        const cajaId = await resolverCajaParaVenta(schema, ctx.auth.empresa_id, sucursalId, null, {
          exigirAbierta: false,
        });
        if (cajaId) {
          await registrarMovimientoCaja({
            schemaRaw: schema,
            empresaId: ctx.auth.empresa_id,
            sucursalId,
            cajaId,
            tipo: "egreso",
            concepto: `Devolución venta ${venta.numero_control}` + (motivo ? ` · ${motivo}` : ""),
            monto: res.monto,
            metodoPago: "efectivo",
            usuarioId: ctx.auth.usuarioCatalogId ?? null,
            usuarioNombre: firmaDeUsuario(ctx.auth),
          });
          caja = "registrada";
        }
      } catch (e) {
        // El stock ya volvió y eso no se deshace por un problema de caja: se
        // informa para que el egreso se cargue a mano.
        console.error("[/api/ventas/[id]/devolucion] egreso de caja:", e instanceof Error ? e.message : e);
        caja = "sin_caja";
      }
    }

    return NextResponse.json(successResponse({ monto: res.monto, devueltos: res.devueltos, caja }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/ventas/[id]/devolucion POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo registrar la devolución."), { status: 500 });
  }
}
