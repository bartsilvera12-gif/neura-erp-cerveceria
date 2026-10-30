import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { normalizarGastoInput } from "@/lib/gastos/payload";

/**
 * PATCH /api/gastos/[id] — edita un gasto de la sucursal activa.
 * DELETE /api/gastos/[id] — lo borra.
 *
 * Los dos filtran por empresa Y sucursal: con el UUID a mano, sin el filtro se
 * podía tocar el gasto de otra sucursal. Y los dos miran cuántas filas
 * matchearon, porque para PostgREST un UPDATE o un DELETE que no matchea nada
 * no es un error: devolvía éxito y la pantalla mostraba el cambio hasta el
 * siguiente refresh.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const sucursal_id = exigirSucursal(auth);

    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json(errorResponse("Falta el id del gasto."), { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const norm = normalizarGastoInput(body, { parcial: true });
    if (!norm.ok) {
      return NextResponse.json(errorResponse(norm.error), { status: 400 });
    }

    const { data, error } = await supabase
      .from("gastos")
      .update(norm.campos)
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursal_id)
      .eq("id", id)
      .select();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    const filas = (data ?? []) as Record<string, unknown>[];
    if (filas.length === 0) {
      return NextResponse.json(
        errorResponse("Ese gasto no existe en la sucursal activa."),
        { status: 404 }
      );
    }
    return NextResponse.json(successResponse(filas[0]));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[PATCH /api/gastos/[id]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar el gasto."), { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const sucursal_id = exigirSucursal(auth);

    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json(errorResponse("Falta el id del gasto."), { status: 400 });
    }

    const { data, error } = await supabase
      .from("gastos")
      .delete()
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursal_id)
      .eq("id", id)
      .select("id");

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        errorResponse("Ese gasto no existe en la sucursal activa."),
        { status: 404 }
      );
    }
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[DELETE /api/gastos/[id]]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar el gasto."), { status: 500 });
  }
}
