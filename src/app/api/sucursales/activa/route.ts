import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import {
  SUCURSAL_COOKIE,
  SUCURSAL_COOKIE_MAX_AGE,
  SUCURSAL_CONSOLIDADO,
  esUuidSucursal,
} from "@/lib/sucursales/activa";

/**
 * POST /api/sucursales/activa — cambia la sucursal en la que opera la sesión.
 *
 * Sólo deja elegir sucursales declaradas en `usuario_sucursales` para este
 * usuario. La cookie no otorga acceso por sí sola (el servidor la revalida en
 * cada request, ver `@/lib/sucursales/activa`), pero rechazar acá es lo que le
 * da al usuario un error claro en vez de una pantalla que no cambia.
 */
export async function POST(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }
    const { catalogUsuario, supabaseSr } = r;
    if (!catalogUsuario?.id) {
      return NextResponse.json({ error: "Usuario sin ficha en el ERP." }, { status: 409 });
    }

    const body = (await request.json().catch(() => null)) as { sucursal_id?: unknown } | null;
    const pedida = typeof body?.sucursal_id === "string" ? body.sucursal_id.trim() : "";
    const quiereConsolidado = pedida === SUCURSAL_CONSOLIDADO;

    if (!quiereConsolidado && !esUuidSucursal(pedida)) {
      return NextResponse.json({ error: "sucursal_id inválido." }, { status: 400 });
    }

    const { data: acceso, error } = await supabaseSr
      .from("usuario_sucursales")
      .select("sucursal_id")
      .eq("usuario_id", catalogUsuario.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const permitidas = (acceso ?? []).map((r: { sucursal_id?: unknown }) =>
      typeof r.sucursal_id === "string" ? r.sucursal_id : ""
    );

    if (quiereConsolidado) {
      // Con una sola sucursal no hay nada que consolidar, y aceptarlo dejaría
      // al usuario en un estado donde no puede operar sin ganar nada.
      if (permitidas.length < 2) {
        return NextResponse.json(
          { error: "La vista consolidada necesita acceso a más de una sucursal." },
          { status: 403 }
        );
      }
    } else if (!permitidas.includes(pedida)) {
      return NextResponse.json(
        { error: "No tenés acceso a esa sucursal." },
        { status: 403 }
      );
    }

    const res = NextResponse.json({ ok: true, sucursal_id: pedida });
    res.cookies.set({
      name: SUCURSAL_COOKIE,
      value: pedida,
      path: "/",
      maxAge: SUCURSAL_COOKIE_MAX_AGE,
      sameSite: "lax",
      // Sin httpOnly a propósito: no es una credencial y el servidor la
      // revalida siempre. Sin secure, porque el ERP se sirve por HTTP detrás
      // de Cloudflare, que es quien termina el TLS.
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo cambiar de sucursal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
