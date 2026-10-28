import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { insertRecetaFormato, listRecetaFormatos } from "@/lib/recetas/recetas-pg";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

type RouteCtx = { params: Promise<{ id: string }> };

/** Unidades aceptadas como capacidad de un envase. Volumen o conteo, nunca masa. */
const UNIDADES_CAPACIDAD = new Set(["ML", "L", "LT", "LTS", "UNIDAD", "UNID", "U"]);

export async function GET(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const formatos = await listRecetaFormatos(ctx.supabase, id);
    return NextResponse.json(successResponse({ formatos }));
  } catch (err) {
    console.error("[/api/recetas/[id]/formatos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los formatos."), { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id: recetaId } = await params;
    // Editar la receta (y sus formatos): solo admin/supervisor.
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const producto_id = typeof body.producto_id === "string" ? body.producto_id : null;
    const capacidad = typeof body.capacidad === "number" ? body.capacidad : null;
    const capacidad_unidad =
      typeof body.capacidad_unidad === "string" ? body.capacidad_unidad.trim() : "";

    if (!producto_id || capacidad == null || capacidad <= 0 || !capacidad_unidad) {
      return NextResponse.json(
        errorResponse("producto_id, capacidad>0 y capacidad_unidad son obligatorios."),
        { status: 400 }
      );
    }
    if (!UNIDADES_CAPACIDAD.has(capacidad_unidad.toUpperCase())) {
      return NextResponse.json(
        errorResponse(
          `Unidad de capacidad no válida: ${capacidad_unidad}. Usá ml, L o unidad.`
        ),
        { status: 400 }
      );
    }

    const row = await insertRecetaFormato(
      ctx.supabase,
      ctx.auth.empresa_id,
      exigirSucursal(ctx.auth),
      recetaId,
      {
        producto_id,
        capacidad,
        capacidad_unidad,
        orden: typeof body.orden === "number" ? body.orden : 0,
      }
    );
    return NextResponse.json(successResponse({ formato: row }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    const msg = err instanceof Error ? err.message : String(err);
    if (/receta_formatos_producto_uq|duplicate/i.test(msg)) {
      return NextResponse.json(
        errorResponse("Ese producto ya es un formato de esta receta."),
        { status: 409 }
      );
    }
    console.error("[/api/recetas/[id]/formatos POST]", msg);
    return NextResponse.json(errorResponse("No se pudo agregar el formato."), { status: 500 });
  }
}
