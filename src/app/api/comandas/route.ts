import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { asMetadataObject, getFacturacionEstado } from "@/lib/caja/facturacion";
import { comandasDePedido, ordenarComandas, type Comanda } from "@/lib/comandas/comandas-domain";
import { isoLocalPy } from "@/lib/fecha/paraguay";

/**
 * GET /api/comandas — lo que la barra y la cocina tienen que preparar.
 *
 * Las comandas no son una tabla: son las rondas de las mesas abiertas y los
 * pedidos que dejan las ventas de mostrador. Acá se juntan y se ordenan.
 *
 * QUE ENTRA Y QUE NO
 * Entran las mesas abiertas y las que están esperando cobro (la cocina sigue
 * teniendo que entregar lo de la última ronda aunque la cuenta ya se haya
 * cerrado), y los pedidos de venta del día. No entran las mesas ya cobradas ni
 * las canceladas: ahí no queda nada por preparar.
 *
 * `?desde=` acota los pedidos de venta; por defecto, hoy. Sin ese corte, la
 * pantalla arrastraría las comandas de todas las noches anteriores.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);

    const sp = request.nextUrl.searchParams;
    const desdeParam = (sp.get("desde") ?? "").trim();
    // La jornada de un bar cruza la medianoche, así que el corte por defecto es
    // "las últimas 18 horas" y no "desde las 00:00": a la 1 de la mañana la
    // cocina sigue mirando lo que entró a las 23.
    const desde = /^\d{4}-\d{2}-\d{2}/.test(desdeParam)
      ? desdeParam
      : isoLocalPy(new Date(Date.now() - 18 * 60 * 60 * 1000));

    const { data, error } = await sb
      .from("proyectos")
      .select("id, brief_data, metadata, fecha_ingreso, created_at")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("archivado", false)
      .gte("fecha_ingreso", desde)
      .order("fecha_ingreso", { ascending: true })
      .limit(300);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const comandas: Comanda[] = [];
    for (const fila of (data ?? []) as Array<Record<string, unknown>>) {
      const metadata = asMetadataObject(fila.metadata);
      const esMesa = metadata.mesa_abierta === true;
      const esVenta = metadata.source === "venta";
      if (!esMesa && !esVenta) continue;

      // Una mesa ya cobrada o cancelada no tiene nada esperando en la cocina.
      const facturacion = getFacturacionEstado(metadata);
      if (esMesa && (facturacion === "facturado" || facturacion === "cancelado_caja")) continue;

      comandas.push(
        ...comandasDePedido({
          id: String(fila.id),
          brief: asMetadataObject(fila.brief_data),
          metadata,
          fechaPedido: String(fila.fecha_ingreso ?? fila.created_at ?? ""),
        })
      );
    }

    const ordenadas = ordenarComandas(comandas);
    return NextResponse.json(
      successResponse({
        comandas: ordenadas,
        pendientes: ordenadas.filter((c) => c.estado !== "listo").length,
      })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/comandas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las comandas."), { status: 500 });
  }
}
