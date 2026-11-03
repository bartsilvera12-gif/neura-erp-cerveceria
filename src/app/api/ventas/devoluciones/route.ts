import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursales, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { esMovimientoDeDevolucion } from "@/lib/ventas/devolucion-domain";
import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";
import {
  agruparDevoluciones,
  totalesDevoluciones,
  type MovimientoDevolucion,
} from "@/lib/ventas/devoluciones-listado";

/**
 * GET /api/ventas/devoluciones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Las devoluciones son los movimientos de ENTRADA con origen
 * `devolucion_venta`: no hay tabla aparte, porque el movimiento ES el hecho.
 *
 * Es un informe de lectura, así que en la vista consolidada muestra las dos
 * sucursales.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;
    const sucursales = exigirSucursales(auth);

    const sp = request.nextUrl.searchParams;
    const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
    const hasta = ymd(sp.get("hasta")) ?? hoy;
    const desdeDefault = new Date(hoy + "T12:00:00Z");
    desdeDefault.setUTCDate(desdeDefault.getUTCDate() - 30);
    const desde = ymd(sp.get("desde")) ?? desdeDefault.toISOString().slice(0, 10);

    /**
     * Trae los dos orígenes posibles y descarta después lo que no es una
     * devolución.
     *
     * `anulacion_venta` es el plan B con el que se guarda una devolución
     * cuando la base no conoce el origen nuevo: filtrando sólo por
     * `devolucion_venta`, esas devoluciones existían en el stock y en la caja
     * pero no aparecían en ninguna lista.
     *
     * Las fechas se acotan por el DÍA de Asunción: una devolución de las 22 h
     * cae en el día siguiente si se compara en UTC, y desaparecía del filtro.
     */
    const { start, end } = asuncionRangeBoundsUtc(desde, hasta);
    const movsQ = await sb
      .from("movimientos_inventario")
      .select("id, venta_id, producto_id, producto_nombre, producto_sku, cantidad, fecha, origen, referencia, usuario_nombre")
      .eq("empresa_id", empresaId)
      .in("sucursal_id", sucursales)
      .in("origen", ["devolucion_venta", "anulacion_venta"])
      .gte("fecha", start)
      .lte("fecha", end)
      .order("fecha", { ascending: false })
      .limit(1000);
    if (movsQ.error) return NextResponse.json(errorResponse(movsQ.error.message), { status: 400 });

    const movs = ((movsQ.data ?? []) as Array<Record<string, unknown>>)
      .filter((m) => esMovimientoDeDevolucion(m.origen, m.referencia))
      .map(
      (m): MovimientoDevolucion => ({
        id: String(m.id),
        venta_id: m.venta_id == null ? null : String(m.venta_id),
        producto_id: String(m.producto_id ?? ""),
        producto_nombre: String(m.producto_nombre ?? ""),
        producto_sku: m.producto_sku == null ? null : String(m.producto_sku),
        cantidad: Number(m.cantidad) || 0,
        fecha: String(m.fecha ?? ""),
        referencia: m.referencia == null ? null : String(m.referencia),
        usuario_nombre: m.usuario_nombre == null ? null : String(m.usuario_nombre),
      })
    );

    const ventaIds = [...new Set(movs.map((m) => m.venta_id).filter((v): v is string => !!v))];

    // El precio que esa venta cobró por ese producto: es lo que se le devuelve
    // al cliente, y no vive en el movimiento.
    const precios = new Map<string, number>();
    const numerosPorVenta = new Map<string, string>();
    if (ventaIds.length > 0) {
      const itemsQ = await sb
        .from("ventas_items")
        .select("venta_id, producto_id, precio_venta")
        .eq("empresa_id", empresaId)
        .in("venta_id", ventaIds);
      if (!itemsQ.error) {
        for (const r of (itemsQ.data ?? []) as Array<Record<string, unknown>>) {
          const clave = `${String(r.venta_id)}:${String(r.producto_id)}`;
          if (!precios.has(clave)) precios.set(clave, Number(r.precio_venta) || 0);
        }
      }
      const ventasQ = await sb
        .from("ventas")
        .select("id, numero_control")
        .eq("empresa_id", empresaId)
        .in("id", ventaIds);
      if (!ventasQ.error) {
        for (const r of (ventasQ.data ?? []) as Array<Record<string, unknown>>) {
          numerosPorVenta.set(String(r.id), String(r.numero_control ?? ""));
        }
      }
    }

    const devoluciones = agruparDevoluciones(movs, precios, numerosPorVenta);
    return NextResponse.json(
      successResponse({
        devoluciones,
        totales: totalesDevoluciones(devoluciones),
        desde,
        hasta,
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/ventas/devoluciones]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las devoluciones."), { status: 500 });
  }
}
