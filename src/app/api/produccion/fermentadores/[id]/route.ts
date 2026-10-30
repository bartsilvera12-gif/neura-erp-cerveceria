import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireEdicionRecetas } from "@/lib/recetas/require-edicion-recetas";
import { updateFermentador } from "@/lib/produccion/lotes-pg";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/produccion/fermentadores/[id] — editar un fermentador.
 * DELETE /api/produccion/fermentadores/[id] — borrarlo, si nunca se usó.
 *
 * Mismo permiso que editar recetas (admin/supervisor): es equipamiento, no
 * algo del día a día.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<{
      codigo: string;
      nombre: string;
      capacidad_litros: number;
      activo: boolean;
      notas: string | null;
    }> = {};

    if (body.codigo !== undefined) {
      const v = String(body.codigo).trim();
      if (!v) return NextResponse.json(errorResponse("El código no puede quedar vacío."), { status: 400 });
      patch.codigo = v;
    }
    if (body.nombre !== undefined) {
      const v = String(body.nombre).trim();
      if (!v) return NextResponse.json(errorResponse("El nombre no puede quedar vacío."), { status: 400 });
      patch.nombre = v;
    }
    if (body.capacidad_litros !== undefined) {
      const n = Number(body.capacidad_litros);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(errorResponse("La capacidad tiene que ser mayor a 0."), { status: 400 });
      }
      patch.capacidad_litros = n;
    }
    if (body.activo !== undefined) patch.activo = body.activo === true;
    if (body.notas !== undefined) {
      const v = body.notas == null ? "" : String(body.notas).trim();
      patch.notas = v === "" ? null : v;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay nada que cambiar."), { status: 400 });
    }

    // La capacidad no se achica por debajo de lo que hay fermentando ahora: el
    // lote no se muda solo, y el número dejaría de describir el tanque.
    if (patch.capacidad_litros != null) {
      const { data: lote } = await ctx.supabase
        .from("produccion_lotes")
        .select("codigo, volumen_obtenido, volumen_planificado")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("fermentador_id", id)
        .in("estado", ["cocimiento", "fermentacion", "maduracion", "carbonatacion", "envasado"])
        .limit(1)
        .maybeSingle();
      const ocupado = lote as { codigo: string; volumen_obtenido: number | null; volumen_planificado: number | null } | null;
      const litros = Number(ocupado?.volumen_obtenido ?? ocupado?.volumen_planificado ?? 0);
      if (ocupado && litros > patch.capacidad_litros) {
        return NextResponse.json(
          errorResponse(
            `El lote ${ocupado.codigo} está fermentando ${litros} L acá: no se puede dejar la capacidad en ${patch.capacidad_litros} L.`
          ),
          { status: 409 }
        );
      }
    }

    const row = await updateFermentador(ctx.supabase, ctx.auth.empresa_id, id, patch);
    return NextResponse.json(successResponse({ fermentador: row }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    const msg = err instanceof Error ? err.message : String(err);
    if (/fermentadores_codigo_uq|duplicate/i.test(msg)) {
      return NextResponse.json(errorResponse("Ya existe otro fermentador con ese código."), { status: 409 });
    }
    console.error("[/api/produccion/fermentadores/[id] PATCH]", msg);
    return NextResponse.json(errorResponse("No se pudo guardar el fermentador."), { status: 500 });
  }
}

/**
 * Se borra sólo si NUNCA se usó.
 *
 * Un fermentador con lotes es parte del historial de producción: borrarlo
 * dejaría lotes apuntando a un tanque que no existe y nadie podría decir dónde
 * fermentó esa cerveza. Si el tanque se dio de baja, va desactivado — sigue en
 * la lista, en gris, y el historial se mantiene.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const guard = await requireEdicionRecetas(request);
    if (!guard.ok) return guard.response;
    const ctx = guard.ctx;
    const sucursalId = exigirSucursal(ctx.auth);
    const { id } = await params;

    const { data: lotes, error: errLotes } = await ctx.supabase
      .from("produccion_lotes")
      .select("id, codigo, estado")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("fermentador_id", id)
      .limit(3);
    if (errLotes) return NextResponse.json(errorResponse(errLotes.message), { status: 500 });

    const usados = (lotes ?? []) as Array<{ codigo: string; estado: string }>;
    if (usados.length > 0) {
      const cuales = usados.map((l) => l.codigo).join(", ");
      return NextResponse.json(
        errorResponse(
          `No se puede borrar: fermentó ${cuales}${usados.length >= 3 ? " y otros" : ""}. ` +
            `Si el tanque se dio de baja, desactivalo: queda en la lista y el historial no se pierde.`
        ),
        { status: 409 }
      );
    }

    const { data, error } = await ctx.supabase
      .from("fermentadores")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("id", id)
      .select("id");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json(errorResponse("Ese fermentador no existe en esta sucursal."), { status: 404 });
    }
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    const sr = respuestaSucursalNoAsignada(err);
    if (sr) return sr;
    console.error("[/api/produccion/fermentadores/[id] DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo borrar el fermentador."), { status: 500 });
  }
}
