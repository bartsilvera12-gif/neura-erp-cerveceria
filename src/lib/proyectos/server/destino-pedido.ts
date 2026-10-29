import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Dónde va a parar un pedido nuevo: su tipo de proyecto y la columna inicial
 * del tablero.
 *
 * ANTES ESTO BUSCABA DOS CÓDIGOS A MANO y fallaba con "Tipo de proyecto
 * 'pedido' no configurado para esta empresa":
 *
 *   · El tipo `pedido` no existía. No es una preferencia del cliente: es una
 *     fila que la función necesita para guardar el pedido. Si falta, se crea,
 *     igual que hace `/api/proyectos/tipos` con los suyos.
 *   · El estado se buscaba por `codigo = 'nuevo'`. Eso obliga a que la primera
 *     columna del tablero se llame así, cuando la tabla YA dice cuál es con
 *     `es_estado_inicial`. Renombrar la columna a "Pendiente" desde
 *     Configuración rompía la creación de pedidos sin ninguna señal.
 *
 * Ahora manda `es_estado_inicial`, y `'nuevo'` queda sólo como respaldo para
 * una instalación vieja donde nadie marcó la inicial.
 */
export async function resolverDestinoPedido(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<{ tipoId: string; estadoId: string }> {
  const tipoId = await resolverTipoPedido(sb, empresaId);

  const { data: inicial, error: errInicial } = await sb
    .from("proyecto_estados")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("es_estado_inicial", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (errInicial) throw new Error(errInicial.message);
  if (inicial) return { tipoId, estadoId: (inicial as { id: string }).id };

  const { data: porCodigo, error: errCodigo } = await sb
    .from("proyecto_estados")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("codigo", "nuevo")
    .limit(1)
    .maybeSingle();
  if (errCodigo) throw new Error(errCodigo.message);
  if (porCodigo) return { tipoId, estadoId: (porCodigo as { id: string }).id };

  // Las columnas del tablero sí son una decisión del cliente, así que acá no
  // se inventa ninguna: se dice qué falta y dónde se arregla.
  throw new Error(
    "El tablero de Pedidos no tiene columnas cargadas, así que el pedido no tiene dónde entrar. " +
      "Cargalas en Configuración → Proyectos y marcá cuál es la inicial."
  );
}

async function resolverTipoPedido(sb: AppSupabaseClient, empresaId: string): Promise<string> {
  const { data, error } = await sb
    .from("proyecto_tipos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("codigo", "pedido")
    .eq("activo", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return (data as { id: string }).id;

  // Puede existir desactivado: reactivarlo en vez de chocar con el único
  // (empresa_id, codigo).
  const { data: creado, error: errUpsert } = await sb
    .from("proyecto_tipos")
    .upsert(
      {
        empresa_id: empresaId,
        nombre: "Pedido",
        codigo: "pedido",
        descripcion: "Pedidos del salón y de delivery. Lo crea el sistema.",
        activo: true,
      } as never,
      { onConflict: "empresa_id,codigo" }
    )
    .select("id")
    .limit(1)
    .maybeSingle();
  if (errUpsert) throw new Error(errUpsert.message);
  if (!creado) throw new Error("No se pudo crear el tipo de proyecto 'pedido'.");
  return (creado as { id: string }).id;
}
