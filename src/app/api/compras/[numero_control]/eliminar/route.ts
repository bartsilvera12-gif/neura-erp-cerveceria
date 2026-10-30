import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { requireAdminEmpresa } from "@/lib/auth/require-admin-empresa";

/**
 * DELETE /api/compras/[numero_control]/eliminar
 *
 * Borra definitivamente una compra YA ANULADA.
 *
 * POR QUE SOLO ANULADA, Y NO CUALQUIERA
 * Una compra registrada no es un papel: sumó stock, pudo haber dejado una
 * cuenta por pagar y movió el costo promedio del producto. Borrar esa fila no
 * deshace nada de eso — deja el stock inflado y el kardex con una entrada sin
 * origen, y nadie se entera hasta el próximo conteo.
 *
 * Anular SÍ deshace todo eso: reintegra el stock en reverso y cierra la CxP.
 * Por eso el camino es anular primero y, si además no se la quiere ver más en
 * la lista, borrarla después. Para entonces ya no queda nada colgando de ella.
 *
 * Solo admin: es irreversible y saca una fila del historial de compras.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ numero_control: string }> }
) {
  try {
    const guard = await requireAdminEmpresa(request);
    if (!guard.ok) return guard.response;

    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase: sb } = ctx;
    const empresaId = auth.empresa_id;

    const { numero_control } = await params;
    const numero = decodeURIComponent(numero_control ?? "").trim();
    if (!numero) {
      return NextResponse.json(errorResponse("numero_control es obligatorio"), { status: 400 });
    }

    const q = await sb
      .from("compras")
      .select("id, estado")
      .eq("empresa_id", empresaId)
      .eq("numero_control", numero);
    if (q.error) return NextResponse.json(errorResponse(q.error.message), { status: 500 });

    const filas = (q.data ?? []) as Array<{ id: string; estado: string | null }>;
    if (filas.length === 0) {
      return NextResponse.json(errorResponse("No existe esa compra."), { status: 404 });
    }

    // La condición se comprueba acá y no sólo en la pantalla: el botón se
    // puede saltear llamando a la URL.
    const vivas = filas.filter((f) => f.estado !== "anulada");
    if (vivas.length > 0) {
      return NextResponse.json(
        errorResponse(
          "Solo se puede eliminar una compra ya anulada. Anulala primero: así el stock se reintegra y la cuenta por pagar se cierra."
        ),
        { status: 409 }
      );
    }

    const del = await sb
      .from("compras")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("numero_control", numero)
      .eq("estado", "anulada");
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 500 });

    return NextResponse.json(successResponse({ numero_control: numero, eliminadas: filas.length }));
  } catch (err) {
    console.error("[/api/compras/[numero_control]/eliminar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar la compra."), { status: 500 });
  }
}
