import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Devuelve al inventario lo que consumió una producción.
 *
 * CUANDO SE USA
 * Al cancelar un lote que ya hizo el cocimiento. La cocción se perdió, pero la
 * materia prima no siempre: si se cancela antes de envasar nada, lo correcto es
 * que las maltas vuelvan al stock y que los litros de granel que nunca
 * existieron salgan de él.
 *
 * NO BORRA NADA
 * La producción y sus movimientos quedan donde están; esto agrega los
 * movimientos INVERSOS. El kardex termina contando la historia completa — se
 * fabricó, se perdió, volvió la materia prima — en vez de fingir que nunca
 * pasó. Un stock que cambia sin un movimiento que lo explique es justamente lo
 * que después nadie puede auditar.
 */

export type ResultadoReversa = {
  insumos_devueltos: number;
  litros_quitados: number;
};

export async function revertirProduccionPg(
  sb: AppSupabaseClient,
  args: {
    empresaId: string;
    produccionId: string;
    /** Para la referencia del movimiento: "Cancelación del lote coven-001". */
    motivo: string;
    usuarioId?: string | null;
    usuarioNombre?: string | null;
  }
): Promise<ResultadoReversa> {
  const { data: prodData, error: errProd } = await sb
    .from("producciones")
    .select("id, producto_id, producto_nombre, cantidad_fabricada, costo_unitario")
    .eq("empresa_id", args.empresaId)
    .eq("id", args.produccionId)
    .maybeSingle();
  if (errProd) throw new Error(errProd.message);
  if (!prodData) throw new Error("No se encontró la producción del lote.");
  const prod = prodData as {
    id: string;
    producto_id: string;
    producto_nombre: string;
    cantidad_fabricada: number | string;
    costo_unitario: number | string;
  };

  // Una producción se revierte UNA vez: si ya hay movimientos de reversa
  // apuntando a ella, se corta acá en vez de devolver las maltas dos veces.
  const { data: yaRevertida, error: errYa } = await sb
    .from("movimientos_inventario")
    .select("id")
    .eq("empresa_id", args.empresaId)
    .eq("produccion_id", args.produccionId)
    .eq("tipo", "ENTRADA")
    .eq("origen", "ajuste_manual")
    .limit(1);
  if (errYa) throw new Error(errYa.message);
  if ((yaRevertida ?? []).length > 0) {
    return { insumos_devueltos: 0, litros_quitados: 0 };
  }

  const fecha = new Date().toISOString();
  const referencia = `Reversa: ${args.motivo}`.slice(0, 200);

  // 1) Las maltas vuelven.
  const { data: items, error: errItems } = await sb
    .from("produccion_items")
    .select("insumo_producto_id, insumo_nombre, cantidad, costo_unitario")
    .eq("empresa_id", args.empresaId)
    .eq("produccion_id", args.produccionId);
  if (errItems) throw new Error(errItems.message);

  const filas = (items ?? []) as Array<{
    insumo_producto_id: string;
    insumo_nombre: string;
    cantidad: number | string;
    costo_unitario: number | string;
  }>;

  let devueltos = 0;
  for (const it of filas) {
    const cantidad = Number(it.cantidad) || 0;
    if (cantidad <= 0) continue;

    const { data: prodRow, error: errLeer } = await sb
      .from("productos")
      .select("stock_actual, sku")
      .eq("empresa_id", args.empresaId)
      .eq("id", it.insumo_producto_id)
      .maybeSingle();
    if (errLeer) throw new Error(errLeer.message);
    if (!prodRow) continue;
    const actual = Number((prodRow as { stock_actual: number | string }).stock_actual) || 0;
    const sku = String((prodRow as { sku?: string }).sku ?? "");

    const upd = await sb
      .from("productos")
      .update({ stock_actual: actual + cantidad })
      .eq("empresa_id", args.empresaId)
      .eq("id", it.insumo_producto_id);
    if (upd.error) throw new Error(upd.error.message);

    const mov = await sb.from("movimientos_inventario").insert({
      empresa_id: args.empresaId,
      producto_id: it.insumo_producto_id,
      producto_nombre: it.insumo_nombre,
      producto_sku: sku,
      tipo: "ENTRADA",
      cantidad,
      costo_unitario: Number(it.costo_unitario) || 0,
      // `origen` está acotado por CHECK y no tiene un valor para esto; la
      // reversa es un ajuste, y la referencia dice de qué lote vino.
      origen: "ajuste_manual",
      referencia,
      fecha,
      produccion_id: args.produccionId,
      created_by: args.usuarioId ?? null,
      usuario_nombre: args.usuarioNombre ?? null,
    });
    if (mov.error) throw new Error(mov.error.message);
    devueltos++;
  }

  // 2) El granel que nunca llegó a existir sale del stock.
  const litros = Number(prod.cantidad_fabricada) || 0;
  if (litros > 0) {
    const { data: granel, error: errGranel } = await sb
      .from("productos")
      .select("stock_actual, sku")
      .eq("empresa_id", args.empresaId)
      .eq("id", prod.producto_id)
      .maybeSingle();
    if (errGranel) throw new Error(errGranel.message);
    if (granel) {
      const actual = Number((granel as { stock_actual: number | string }).stock_actual) || 0;
      const upd = await sb
        .from("productos")
        // Nunca por debajo de 0: si parte del granel ya se movió a otro lado,
        // el movimiento registra la salida real y el stock queda en cero.
        .update({ stock_actual: Math.max(0, actual - litros) })
        .eq("empresa_id", args.empresaId)
        .eq("id", prod.producto_id);
      if (upd.error) throw new Error(upd.error.message);

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: args.empresaId,
        producto_id: prod.producto_id,
        producto_nombre: prod.producto_nombre,
        producto_sku: String((granel as { sku?: string }).sku ?? ""),
        tipo: "SALIDA",
        cantidad: litros,
        costo_unitario: Number(prod.costo_unitario) || 0,
        origen: "ajuste_manual",
        referencia,
        fecha,
        produccion_id: args.produccionId,
        created_by: args.usuarioId ?? null,
        usuario_nombre: args.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }
  }

  return { insumos_devueltos: devueltos, litros_quitados: litros };
}
