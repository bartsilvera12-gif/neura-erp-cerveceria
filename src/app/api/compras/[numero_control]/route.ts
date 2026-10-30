import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { errorNumeroComprobante } from "@/lib/validacion/documentos";

/**
 * PATCH /api/compras/[numero_control] — corrige los DATOS DE FACTURA de una compra.
 *
 * QUE SE PUEDE EDITAR Y QUE NO
 * Sólo el número de factura del proveedor, la fecha de la factura y el método
 * de pago. Nada de eso movió stock ni plata: son datos del comprobante que se
 * cargan mal, o se cargan después cuando la factura llega tarde.
 *
 * Las cantidades, los costos y el proveedor NO se editan acá a propósito. Una
 * compra registrada ya sumó stock, movió el costo del producto y pudo dejar una
 * cuenta por pagar; cambiar un costo con un UPDATE deja el kardex diciendo una
 * cosa y la compra otra, y nadie se entera hasta el próximo conteo. Para eso
 * está anular (que reintegra el stock en reverso y cierra la CxP) y volver a
 * cargar.
 *
 * Una compra ANULADA no se toca: su historia ya está cerrada.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);

    const { numero_control } = await params;
    const numero = decodeURIComponent(numero_control ?? "").trim();
    if (!numero) {
      return NextResponse.json(errorResponse("Falta el número de control."), { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json(errorResponse("Body inválido."), { status: 400 });

    const update: Record<string, unknown> = {};

    if (body.numero_factura_proveedor !== undefined) {
      const n = String(body.numero_factura_proveedor ?? "").trim();
      if (n === "") {
        update.numero_factura_proveedor = null;
      } else {
        const err = errorNumeroComprobante(n);
        if (err) return NextResponse.json(errorResponse(err), { status: 400 });
        update.numero_factura_proveedor = n;
      }
    }

    if (body.fecha_factura !== undefined) {
      const f = String(body.fecha_factura ?? "").trim();
      if (f === "") {
        update.fecha_factura = null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        return NextResponse.json(errorResponse("La fecha de la factura va en formato AAAA-MM-DD."), {
          status: 400,
        });
      } else {
        update.fecha_factura = f;
      }
    }

    if (body.metodo_pago !== undefined) {
      const m = body.metodo_pago;
      if (m == null || m === "") update.metodo_pago = null;
      else if (m === "efectivo" || m === "transferencia" || m === "tarjeta") update.metodo_pago = m;
      else {
        return NextResponse.json(
          errorResponse("El método de pago tiene que ser efectivo, transferencia o tarjeta."),
          { status: 400 }
        );
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(errorResponse("No hay nada que actualizar."), { status: 400 });
    }

    const q = await sb
      .from("compras")
      .select("id, estado")
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("numero_control", numero);
    if (q.error) return NextResponse.json(errorResponse(q.error.message), { status: 500 });

    const filas = (q.data ?? []) as Array<{ id: string; estado: string | null }>;
    if (filas.length === 0) {
      return NextResponse.json(errorResponse("Esa compra no existe en la sucursal activa."), {
        status: 404,
      });
    }
    if (filas.some((f) => f.estado === "anulada")) {
      return NextResponse.json(
        errorResponse("La compra está anulada: no se pueden cambiar sus datos."),
        { status: 409 }
      );
    }

    // Las líneas de una compra comparten estos datos, así que se actualizan
    // todas: si no, una compra de tres productos quedaría con dos números de
    // factura distintos.
    const upd = await sb
      .from("compras")
      .update(update)
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("numero_control", numero)
      .select("id");
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(
      successResponse({ numero_control: numero, lineas_actualizadas: (upd.data ?? []).length })
    );
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[PATCH /api/compras/[numero_control]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar el cambio."), { status: 500 });
  }
}
