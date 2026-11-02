import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Editar y borrar un comentario del pedido.
 *
 * QUIEN PUEDE
 * El comentario es de quien lo escribió: sólo esa persona lo edita. Borrarlo
 * puede además un administrador, que es quien limpia lo que no corresponde.
 * Dejar que cualquiera edite palabras ajenas convierte el hilo en algo que no
 * se puede citar.
 *
 * Un comentario editado queda marcado con la fecha del cambio: el que lo lee
 * después tiene que poder saber que no es el texto original.
 */
type Ctx = { params: Promise<{ id: string; comentarioId: string }> };

async function cargar(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string,
  pid: string,
  cid: string
) {
  const { data, error } = await sb
    .from("proyecto_comentarios")
    .select("id, usuario_id, comentario")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", pid)
    .eq("id", cid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; usuario_id: string | null; comentario: string } | null) ?? null;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, comentarioId } = await params;
  const pid = id?.trim() ?? "";
  const cid = comentarioId?.trim() ?? "";
  if (!pid || !cid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as { comentario?: string } | null;
    const texto = typeof body?.comentario === "string" ? body.comentario.trim() : "";
    if (!texto) return NextResponse.json(errorResponse("El comentario no puede quedar vacío."), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const actual = await cargar(sb, auth.empresaId, pid, cid);
    if (!actual) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
    if (String(actual.usuario_id ?? "") !== String(auth.usuarioCatalogId)) {
      return NextResponse.json(
        errorResponse("Ese comentario lo escribió otra persona: no se puede editar."),
        { status: 403 }
      );
    }

    const ahora = new Date().toISOString();
    // `updated_at` puede no existir en instancias viejas: si la base la
    // rechaza, se guarda igual el texto, que es lo que se pidió cambiar.
    let upd = await sb
      .from("proyecto_comentarios")
      .update({ comentario: texto, updated_at: ahora })
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid)
      .select("*");
    if (upd.error && /updated_at/i.test(upd.error.message)) {
      upd = await sb
        .from("proyecto_comentarios")
        .update({ comentario: texto })
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", pid)
        .eq("id", cid)
        .select("*");
    }
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: ahora, updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    const row = Array.isArray(upd.data) ? upd.data[0] : upd.data;
    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, comentarioId } = await params;
  const pid = id?.trim() ?? "";
  const cid = comentarioId?.trim() ?? "";
  if (!pid || !cid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const actual = await cargar(sb, auth.empresaId, pid, cid);
    if (!actual) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const esAutor = String(actual.usuario_id ?? "") === String(auth.usuarioCatalogId);
    if (!esAutor && !esRolAdminEmpresaOGlobal(auth.rol)) {
      return NextResponse.json(
        errorResponse("Ese comentario lo escribió otra persona: sólo un administrador puede borrarlo."),
        { status: 403 }
      );
    }

    const del = await sb
      .from("proyecto_comentarios")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid);
    if (del.error) return NextResponse.json(errorResponse(del.error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    return NextResponse.json(successResponse({ id: cid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
