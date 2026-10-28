import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { cookies } from "next/headers";
import { SUCURSAL_COOKIE, resolverSucursalActiva } from "@/lib/sucursales/activa";

type UsuarioMeRow = {
  nombre: string | null;
  email: string | null;
  rol: string | null;
  sucursal_predeterminada_id: string | null;
  sucursales: { nombre: string | null; maneja_caja: boolean | null } | { nombre: string | null; maneja_caja: boolean | null }[] | null;
};

/** Sucursal a la que el usuario puede entrar, para el selector del header. */
type SucursalOpcion = { id: string; nombre: string; maneja_caja: boolean };

function pickAuthMetadataName(authUser: { user_metadata?: Record<string, unknown> | null }): string | null {
  const meta = authUser.user_metadata ?? {};
  const candidates = [meta.full_name, meta.name, meta.nombre];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * GET /api/usuarios/me
 *
 * Perfil mínimo para el header: resuelve el usuario autenticado server-side y
 * evita leer `usuarios` desde el navegador.
 */
export async function GET(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }

    const { authUser, catalogUsuario, supabaseSr } = r;
    let row: UsuarioMeRow | null = null;

    if (catalogUsuario?.id) {
      const { data, error } = await supabaseSr
        .from("usuarios")
        .select("nombre, email, rol, sucursal_predeterminada_id, sucursales:sucursal_predeterminada_id(nombre, maneja_caja)")
        .eq("id", catalogUsuario.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = (data ?? null) as UsuarioMeRow | null;
    }

    const nombre = (row?.nombre ?? pickAuthMetadataName(authUser) ?? "").trim() || null;
    const email = (row?.email ?? authUser.email ?? "").trim() || null;
    const rol = (row?.rol ?? catalogUsuario?.rol ?? "").trim() || null;

    // PostgREST devuelve el embed como objeto o como array de un elemento
    // segun como resuelva la relacion; se normaliza para no depender de eso.
    const sucRaw = row?.sucursales ?? null;
    const sucObj = Array.isArray(sucRaw) ? sucRaw[0] ?? null : sucRaw;

    /**
     * Sucursales declaradas en `usuario_sucursales`. Con más de una, el header
     * muestra el selector; con una sola (el caso normal) muestra la etiqueta
     * fija de siempre.
     */
    let opciones: SucursalOpcion[] = [];
    if (catalogUsuario?.id) {
      const { data: us } = await supabaseSr
        .from("usuario_sucursales")
        .select("sucursal_id, sucursales:sucursal_id(nombre, activa, maneja_caja)")
        .eq("usuario_id", catalogUsuario.id);
      const filas = (us ?? []) as { sucursal_id?: unknown; sucursales?: unknown }[];
      opciones = filas
        .map((r) => {
          const s = (Array.isArray(r.sucursales) ? r.sucursales[0] : r.sucursales) as
            | { nombre?: unknown; activa?: unknown; maneja_caja?: unknown }
            | null;
          if (!s || s.activa === false) return null;
          const id = typeof r.sucursal_id === "string" ? r.sucursal_id : "";
          const nombreSuc = typeof s.nombre === "string" ? s.nombre.trim() : "";
          if (!id || !nombreSuc) return null;
          return { id, nombre: nombreSuc, maneja_caja: s.maneja_caja !== false };
        })
        .filter((x): x is SucursalOpcion => x !== null)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }

    const porDefecto = row?.sucursal_predeterminada_id ?? null;
    const pedida = (await cookies()).get(SUCURSAL_COOKIE)?.value ?? null;
    const sucursalId = resolverSucursalActiva(pedida, opciones.map((o) => o.id), porDefecto);
    const activa = opciones.find((o) => o.id === sucursalId) ?? null;

    // El embed de la predeterminada sigue siendo el fallback cuando la N:M no
    // está cargada, que es como quedan las instalaciones de una sola sucursal.
    const sucursal = (activa?.nombre ?? sucObj?.nombre ?? "").trim() || null;
    // Sin fila o flag nulo → por defecto opera caja.
    const sucursalManejaCaja = activa
      ? activa.maneja_caja
      : sucObj
        ? sucObj.maneja_caja !== false
        : true;

    return NextResponse.json({
      usuario: {
        nombre,
        rol,
        email,
        sucursal,
        sucursal_id: sucursalId,
        sucursal_maneja_caja: sucursalManejaCaja,
        sucursales: opciones,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al obtener el usuario actual";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
