import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";


/**
 * GET /api/facturas/[id]
 * Factura de la empresa autenticada + texto corto del cliente (para UI).
 *
 * Usa el helper de facturación (PG shim para tenants `erp_*` no expuestos en PostgREST,
 * service role estándar para `zentra_erp` y legacy). Antes usaba `getTenantSupabaseFromAuth`,
 * que devolvía `PGRST106 Invalid schema` para schemas `erp_*`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id } = await params;
    const fid = id?.trim();
    if (!fid) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }


    const { data: factura, error: errF } = await supabase
      .from("facturas")
      .select("*")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const row = factura as { cliente_id: string; origen_venta_id?: string | null };

    /**
     * Cómo se cobró, leído de la venta que originó la factura.
     *
     * La factura no guarda el método de cobro (no es un dato fiscal del
     * documento), pero cuando el cobro fue mixto el operador necesita verlo
     * acá: era el reclamo de que "el pago mixto figura en el recibo pero no en
     * la factura". No corta la respuesta si falla.
     */
    let cobro: { metodo_pago: string | null; pagos_desglose: unknown } | null = null;
    if (row.origen_venta_id) {
      const { data: v } = await supabase
        .from("ventas")
        .select("metodo_pago, pagos_desglose")
        .eq("id", row.origen_venta_id)
        .eq("empresa_id", auth.empresa_id)
        .maybeSingle();
      const vv = v as { metodo_pago?: string | null; pagos_desglose?: unknown } | null;
      if (vv) {
        cobro = {
          metodo_pago: vv.metodo_pago ?? null,
          pagos_desglose: vv.pagos_desglose ?? null,
        };
      }
    }
    const { data: cli } = await supabase
      .from("clientes")
      .select("nombre_contacto, empresa")
      .eq("id", row.cliente_id)
      .maybeSingle();

    const c = cli as { nombre_contacto?: string; empresa?: string } | null;
    const empresa = (c?.empresa ?? "").trim();
    const nombre = (c?.nombre_contacto ?? "").trim();
    const cliente_display = empresa || nombre || "Cliente";

    return NextResponse.json(
      successResponse({
        ...factura,
        cliente_display,
        cobro,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
