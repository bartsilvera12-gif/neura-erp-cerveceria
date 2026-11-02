import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";

export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (body.nombre !== undefined) patch.nombre = normalizeUpperText(body.nombre);
    if (body.codigo !== undefined) patch.codigo = normalizeUpperNullable(body.codigo);
    if (body.descripcion !== undefined) patch.descripcion = normalizeUpperNullable(body.descripcion);
    if (body.parent_id !== undefined) patch.parent_id = body.parent_id == null ? null : String(body.parent_id);
    if (body.activo !== undefined) patch.activo = body.activo === true;

    if (Object.keys(patch).length === 0) {
      const { data, error } = await ctx.supabase
        .from("categorias_productos")
        .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
        .eq("empresa_id", ctx.auth.empresa_id)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
      return NextResponse.json(successResponse({ categoria: data }));
    }

    const upd = await ctx.supabase
      .from("categorias_productos")
      .update(patch)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .select("id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at")
      .maybeSingle();
    if (upd.error) {
      const msg = upd.error.message ?? "";
      if (/duplicate|unique|23505/i.test(msg)) {
        return NextResponse.json(errorResponse("Ya existe una categoría con ese nombre o código."), {
          status: 409,
        });
      }
      console.error("[/api/inventario/categorias/[id] PATCH]", msg);
      return NextResponse.json(errorResponse("No se pudo actualizar la categoría."), { status: 500 });
    }
    if (!upd.data) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    return NextResponse.json(successResponse({ categoria: upd.data }));
  } catch (err) {
    console.error("[/api/inventario/categorias/[id] PATCH] outer", err);
    return NextResponse.json(errorResponse("No se pudo actualizar la categoría."), { status: 500 });
  }
}

/**
 * DELETE /api/inventario/categorias/[id] — borra una categoría vacía.
 *
 * Sólo si no la usa ningún producto y no tiene subcategorías: borrarla igual
 * dejaría productos apuntando a una categoría que ya no existe, y nadie
 * sabría en qué estaban clasificados. Cuando no se puede, la respuesta dice
 * cuántos productos la usan, que es lo que hay que mover primero. Para una
 * categoría con historia, desactivarla es lo correcto: deja de ofrecerse sin
 * borrar lo que ya está clasificado.
 */
export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const sb = ctx.supabase;
    const empresaId = ctx.auth.empresa_id;

    const { data: cat, error: errCat } = await sb
      .from("categorias_productos")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (errCat) throw new Error(errCat.message);
    if (!cat) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const hijas = await sb
      .from("categorias_productos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("parent_id", id);
    if ((hijas.count ?? 0) > 0) {
      return NextResponse.json(
        errorResponse(`Esa categoría tiene ${hijas.count} subcategoría(s). Borralas o movelas primero.`),
        { status: 409 }
      );
    }

    const usados = await sb
      .from("productos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("categoria_principal_id", id);
    if ((usados.count ?? 0) > 0) {
      return NextResponse.json(
        errorResponse(
          `${usados.count} producto(s) están en esa categoría. Cambiales la categoría, o desactivala en vez de borrarla.`
        ),
        { status: 409 }
      );
    }

    // El puente producto_categorias puede tener filas sueltas de una categoría
    // que ya no es la principal de nadie: se limpian con ella.
    await sb.from("producto_categorias").delete().eq("empresa_id", empresaId).eq("categoria_id", id);

    const del = await sb
      .from("categorias_productos")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("id", id);
    if (del.error) {
      const msg = del.error.message ?? "";
      if (/foreign key|23503/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Esa categoría está en uso en otra parte del sistema. Desactivala en vez de borrarla."),
          { status: 409 }
        );
      }
      console.error("[/api/inventario/categorias/[id] DELETE]", msg);
      return NextResponse.json(errorResponse("No se pudo borrar la categoría."), { status: 500 });
    }
    return NextResponse.json(successResponse({ id }));
  } catch (err) {
    console.error("[/api/inventario/categorias/[id] DELETE] outer", err);
    return NextResponse.json(errorResponse("No se pudo borrar la categoría."), { status: 500 });
  }
}
