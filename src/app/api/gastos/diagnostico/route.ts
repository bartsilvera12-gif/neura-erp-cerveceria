import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { requireAdminEmpresa } from "@/lib/auth/require-admin-empresa";
import { NEURA_CLIENT_SCHEMA } from "@/lib/supabase/schema";

/**
 * GET /api/gastos/diagnostico — por qué no se crea un gasto.
 *
 * POR QUE EXISTE
 * "Creé un gasto y no se creó" se puede deber a media docena de cosas que no se
 * distinguen desde la pantalla: la sucursal activa, una columna que falta en el
 * schema, un NOT NULL, un CHECK, RLS. Pedirle a la usuaria que copie el error
 * de la consola no estaba funcionando, así que esto hace el intento real del
 * lado del servidor y devuelve el error de Postgres tal cual, con código y
 * detalle.
 *
 * INSERTA Y BORRA una fila de prueba, marcada como tal. Si el borrado falla, lo
 * dice y queda el id para borrarla a mano: es mejor dejar una fila visible que
 * esconder que quedó.
 *
 * Solo admin: muestra estructura de la base y escribe (aunque sea por un
 * instante) en una tabla real.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdminEmpresa(request);
  if (!guard.ok) return guard.response;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { supabase, auth } = ctx;

  const reporte: Record<string, unknown> = {
    schema: NEURA_CLIENT_SCHEMA,
    empresa_id: auth.empresa_id,
    sucursal_activa: auth.sucursal_id ?? null,
    sucursales_permitidas: auth.sucursal_ids ?? [],
    vista_consolidada: auth.sucursal_consolidada === true,
  };

  // 1. Qué columnas ve PostgREST. Si la tabla está vacía no hay fila de donde
  //    sacarlas, y eso también es un dato.
  const muestra = await supabase.from("gastos").select("*").limit(1);
  reporte.lectura_error = muestra.error
    ? {
        message: muestra.error.message,
        code: muestra.error.code,
        details: muestra.error.details,
        hint: muestra.error.hint,
      }
    : null;
  reporte.columnas_visibles = muestra.data?.[0] ? Object.keys(muestra.data[0]).sort() : null;

  // 2. Cuántos gastos hay y en qué sucursal. Si están todos en una sucursal que
  //    no es la activa, el alta funcionaba y el problema era de qué sucursal
  //    los lista la pantalla.
  const todos = await supabase.from("gastos").select("id, sucursal_id, fecha, monto");
  if (todos.error) {
    reporte.conteo_error = todos.error.message;
  } else {
    const porSucursal = new Map<string, number>();
    for (const g of (todos.data ?? []) as { sucursal_id?: string | null }[]) {
      const k = g.sucursal_id ?? "(sin sucursal)";
      porSucursal.set(k, (porSucursal.get(k) ?? 0) + 1);
    }
    reporte.gastos_total = (todos.data ?? []).length;
    reporte.gastos_por_sucursal = Object.fromEntries(porSucursal);
  }

  // 3. El intento real.
  if (!auth.sucursal_id) {
    reporte.prueba_insert = auth.sucursal_consolidada
      ? "No se probó: estás en la vista consolidada, que es de sólo lectura. Elegí Cervecería o Bar arriba."
      : "No se probó: tu usuario no tiene sucursal activa. Asignale una desde Usuarios.";
    return NextResponse.json(reporte);
  }

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  const fila = {
    empresa_id: auth.empresa_id,
    sucursal_id: auth.sucursal_id,
    categoria: "DIAGNOSTICO",
    descripcion: "FILA DE PRUEBA DEL DIAGNOSTICO - SE BORRA SOLA",
    monto: 1,
    tipo: "variable",
    recurrente: false,
    frecuencia: null,
    fecha: hoy,
    beneficiario: null,
    metodo_pago: null,
  };

  const ins = await supabase.from("gastos").insert(fila).select("id").single();
  if (ins.error) {
    reporte.prueba_insert = "FALLO";
    reporte.prueba_error = {
      message: ins.error.message,
      code: ins.error.code,
      details: ins.error.details,
      hint: ins.error.hint,
    };
    // Segundo intento sin las columnas agregadas después del clon: si este pasa,
    // lo que falta son esas columnas en `cerveceriaerp.gastos` (correr el 17).
    const minimo = {
      empresa_id: fila.empresa_id,
      sucursal_id: fila.sucursal_id,
      categoria: fila.categoria,
      descripcion: fila.descripcion,
      monto: fila.monto,
      tipo: fila.tipo,
      recurrente: fila.recurrente,
      fecha: fila.fecha,
    };
    const ins2 = await supabase.from("gastos").insert(minimo).select("id").single();
    if (ins2.error) {
      reporte.prueba_sin_columnas_nuevas = {
        resultado: "FALLO",
        message: ins2.error.message,
        code: ins2.error.code,
        details: ins2.error.details,
        hint: ins2.error.hint,
      };
    } else {
      reporte.prueba_sin_columnas_nuevas = {
        resultado: "OK — faltan beneficiario/metodo_pago en la tabla: correr el script 17",
      };
      const del = await supabase.from("gastos").delete().eq("id", (ins2.data as { id: string }).id);
      reporte.limpieza = del.error ? `NO se pudo borrar: ${del.error.message}` : "borrada";
    }
    return NextResponse.json(reporte);
  }

  const id = (ins.data as { id: string }).id;
  reporte.prueba_insert = "OK — la base acepta el gasto";
  reporte.prueba_id = id;

  const del = await supabase.from("gastos").delete().eq("id", id).select("id");
  reporte.limpieza =
    del.error
      ? `NO se pudo borrar la fila de prueba (${del.error.message}). Borrala a mano: DELETE FROM ${NEURA_CLIENT_SCHEMA}.gastos WHERE id = '${id}';`
      : (del.data ?? []).length > 0
        ? "fila de prueba borrada"
        : `la fila de prueba no se borró y no hubo error. Borrala a mano: DELETE FROM ${NEURA_CLIENT_SCHEMA}.gastos WHERE id = '${id}';`;

  return NextResponse.json(reporte);
}
