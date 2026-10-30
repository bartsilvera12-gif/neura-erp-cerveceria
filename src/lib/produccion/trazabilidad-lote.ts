import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * De qué lote salió lo que se vendió.
 *
 * EL PROBLEMA
 * El envasado sabe que el lote coven-002 produjo 16 barriles de 30 L. La venta
 * sabe que se vendieron 2 barriles. Nadie sabía cuáles: si mañana un cliente
 * devuelve un barril con olor a cartón, no había forma de decir de qué cocción
 * salió ni a quién más se le vendió de la misma.
 *
 * COMO SE RESUELVE SIN MOLESTAR AL CAJERO
 * Por orden de envasado: lo primero que se envasó es lo primero que sale
 * (FIFO), que es como se mueve un depósito de verdad y lo que cualquiera
 * asumiría. El cajero no elige nada; la asignación ocurre después de registrar
 * la venta.
 *
 * Cada fila de envasado lleva cuántas unidades suyas ya se vendieron, y la
 * línea de la venta guarda el CÓDIGO del lote (no su id): si alguna vez se
 * borra un lote, la venta tiene que seguir diciendo de dónde salió.
 *
 * Una venta puede llevarse unidades de dos lotes si el primero no alcanza; en
 * ese caso se guardan los dos códigos.
 *
 * ES BEST-EFFORT: si esto falla, la venta ya está hecha y no se toca. Perder la
 * trazabilidad es malo; perder la venta, peor.
 */

type ItemVenta = { producto_id: string; cantidad: number };

type FilaEnvasado = {
  id: string;
  lote_id: string;
  cantidad: number | string;
  cantidad_vendida: number | string | null;
  fecha: string;
};

export async function asignarLotesAVenta(
  sb: AppSupabaseClient,
  args: { empresaId: string; ventaId: string; items: ItemVenta[] }
): Promise<Record<string, string>> {
  const asignado: Record<string, string> = {};
  const porProducto = new Map<string, number>();
  for (const it of args.items) {
    const n = Number(it.cantidad) || 0;
    if (n > 0) porProducto.set(it.producto_id, (porProducto.get(it.producto_id) ?? 0) + n);
  }
  if (porProducto.size === 0) return asignado;

  const { data: envasados, error } = await sb
    .from("produccion_lote_envasado")
    .select("id, lote_id, producto_id, cantidad, cantidad_vendida, fecha")
    .eq("empresa_id", args.empresaId)
    .in("producto_id", [...porProducto.keys()])
    .order("fecha", { ascending: true });
  if (error) throw new Error(error.message);

  const filas = (envasados ?? []) as Array<FilaEnvasado & { producto_id: string }>;
  if (filas.length === 0) return asignado;

  // Códigos de lote, en una sola consulta.
  const loteIds = [...new Set(filas.map((f) => f.lote_id))];
  const { data: lotes, error: errLotes } = await sb
    .from("produccion_lotes")
    .select("id, codigo")
    .eq("empresa_id", args.empresaId)
    .in("id", loteIds);
  if (errLotes) throw new Error(errLotes.message);
  const codigoPorLote = new Map(
    ((lotes ?? []) as Array<{ id: string; codigo: string }>).map((l) => [l.id, l.codigo])
  );

  for (const [productoId, pedido] of porProducto) {
    let restante = pedido;
    const usados: string[] = [];

    for (const f of filas) {
      if (f.producto_id !== productoId || restante <= 0) continue;
      const total = Number(f.cantidad) || 0;
      const vendida = Number(f.cantidad_vendida ?? 0) || 0;
      const libre = total - vendida;
      if (libre <= 0) continue;

      const toma = Math.min(libre, restante);
      const upd = await sb
        .from("produccion_lote_envasado")
        .update({ cantidad_vendida: vendida + toma })
        .eq("id", f.id)
        .eq("empresa_id", args.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      f.cantidad_vendida = vendida + toma;
      restante -= toma;

      const codigo = codigoPorLote.get(f.lote_id);
      if (codigo && !usados.includes(codigo)) usados.push(codigo);
    }

    if (usados.length === 0) continue;
    // Si se vendió más de lo envasado (stock cargado a mano, por ejemplo), el
    // resto queda sin lote y la etiqueta lo dice en vez de inventar uno.
    const etiqueta = restante > 0 ? `${usados.join(" + ")} + sin lote` : usados.join(" + ");
    asignado[productoId] = etiqueta;

    const updItem = await sb
      .from("ventas_items")
      .update({ lote_codigo: etiqueta.slice(0, 120) })
      .eq("empresa_id", args.empresaId)
      .eq("venta_id", args.ventaId)
      .eq("producto_id", productoId);
    if (updItem.error) throw new Error(updItem.error.message);
  }

  return asignado;
}

/**
 * Devuelve las unidades al lote cuando se anula una venta.
 *
 * Sin esto, anular dejaría esas unidades contadas como vendidas para siempre y
 * la próxima venta las saltearía, atribuyendo la mercadería al lote siguiente.
 */
export async function devolverLotesDeVenta(
  sb: AppSupabaseClient,
  args: { empresaId: string; ventaId: string }
): Promise<void> {
  const { data: items, error } = await sb
    .from("ventas_items")
    .select("producto_id, cantidad, lote_codigo")
    .eq("empresa_id", args.empresaId)
    .eq("venta_id", args.ventaId);
  if (error) throw new Error(error.message);

  for (const it of (items ?? []) as Array<{
    producto_id: string;
    cantidad: number | string;
    lote_codigo: string | null;
  }>) {
    if (!it.lote_codigo) continue;
    let restante = Number(it.cantidad) || 0;

    // Se devuelve al revés de como se tomó: lo último vendido es lo primero
    // que vuelve.
    const { data: envasados, error: errEnv } = await sb
      .from("produccion_lote_envasado")
      .select("id, cantidad_vendida")
      .eq("empresa_id", args.empresaId)
      .eq("producto_id", it.producto_id)
      .gt("cantidad_vendida", 0)
      .order("fecha", { ascending: false });
    if (errEnv) throw new Error(errEnv.message);

    for (const f of (envasados ?? []) as Array<{ id: string; cantidad_vendida: number | string }>) {
      if (restante <= 0) break;
      const vendida = Number(f.cantidad_vendida) || 0;
      const vuelve = Math.min(vendida, restante);
      const upd = await sb
        .from("produccion_lote_envasado")
        .update({ cantidad_vendida: vendida - vuelve })
        .eq("id", f.id)
        .eq("empresa_id", args.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      restante -= vuelve;
    }
  }
}
