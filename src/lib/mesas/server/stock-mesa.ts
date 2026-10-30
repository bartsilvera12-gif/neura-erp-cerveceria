import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  calcularConsumo,
  salidasDeConsumo,
  type FaltanteStock,
} from "@/lib/inventario/server/consumo-stock";
import type { ItemMesa } from "@/lib/mesas/mesas-domain";

/**
 * El stock de una mesa abierta baja AL SERVIR, no al cobrar.
 *
 * POR QUE
 * Una mesa puede estar abierta tres horas. Si el stock bajara recién al cobrar,
 * durante toda la noche el sistema diría que hay litros de granel que ya se
 * sirvieron, y el bar vendería lo que no tiene. Por eso cada ronda descuenta
 * cuando se manda a la cocina.
 *
 * Y COMO NO SE DESCUENTA DOS VECES
 * Al cerrar la mesa, la venta se crea con `omitirStock`: cobra y factura, pero
 * no vuelve a tocar el stock. Lo que sincroniza las dos puntas es la marca
 * `metadata.stock_descontado_en_mesa` del pedido.
 *
 * La explosión de recetas (un chop descuenta litros del granel) es la misma
 * función que usa la venta: `calcularConsumo`.
 */

/** Movimientos que una ronda escribe, para poder devolverlos si se saca algo. */
const ORIGEN_SALIDA = "venta";
const ORIGEN_DEVOLUCION = "anulacion_venta";

/**
 * La referencia lleva el id de la cuenta, no sólo el nombre de la mesa: la
 * mesa 7 se abre todas las noches, y enganchar por nombre mezclaría los
 * movimientos de una noche con los de otra.
 */
function referenciaRonda(mesa: string, ronda: number, mesaId: string): string {
  return `MESA ${mesa} · Ronda ${ronda} · ${mesaId}`;
}

export type ResultadoStockRonda =
  | { ok: true; faltantes: [] }
  | { ok: false; faltantes: FaltanteStock[] };

/**
 * Descuenta lo que consume una ronda y deja el movimiento SALIDA de cada
 * producto o insumo.
 *
 * `venta_id` va en null: todavía no hay venta. Al cobrar la mesa, los
 * movimientos de la noche se enganchan a la venta que los pagó (ver
 * `vincularMovimientosAVenta`), así el kardex no queda con salidas huérfanas.
 *
 * Si falta stock devuelve el detalle sin tocar nada, salvo que `permitirSinStock`
 * diga lo contrario: a la una de la mañana, con el cliente esperando, el bar
 * decide si sirve igual, y el faltante queda registrado en el movimiento.
 */
export async function descontarRonda(
  sb: AppSupabaseClient,
  args: {
    empresaId: string;
    sucursalId: string;
    mesa: string;
    mesaId: string;
    ronda: number;
    items: ItemMesa[];
    permitirSinStock?: boolean;
    createdBy?: string | null;
    usuarioNombre?: string | null;
  }
): Promise<ResultadoStockRonda> {
  const cantidadPorProducto = new Map<string, number>();
  for (const it of args.items) {
    cantidadPorProducto.set(it.producto_id, (cantidadPorProducto.get(it.producto_id) ?? 0) + it.cantidad);
  }
  if (cantidadPorProducto.size === 0) return { ok: true, faltantes: [] };

  const consumo = await calcularConsumo(sb, args.empresaId, args.sucursalId, cantidadPorProducto);
  if (consumo.faltantes.length > 0 && !args.permitirSinStock) {
    return { ok: false, faltantes: consumo.faltantes };
  }

  const fecha = new Date().toISOString();
  const referencia = referenciaRonda(args.mesa, args.ronda, args.mesaId);

  for (const s of salidasDeConsumo(consumo, cantidadPorProducto)) {
    // El stock nunca queda negativo: si se sirvió sin stock, queda en 0 y la
    // cantidad real sale en el movimiento, que es donde se audita.
    const nuevo = Math.max(0, s.stock_previo - s.cantidad);
    const upd = await sb
      .from("productos")
      .update({ stock_actual: nuevo })
      .eq("id", s.producto_id)
      .eq("empresa_id", args.empresaId);
    if (upd.error) throw new Error(upd.error.message);

    const mov = await sb.from("movimientos_inventario").insert({
      empresa_id: args.empresaId,
      sucursal_id: args.sucursalId,
      producto_id: s.producto_id,
      producto_nombre: s.producto_nombre,
      producto_sku: s.producto_sku,
      tipo: "SALIDA",
      cantidad: s.cantidad,
      costo_unitario: s.costo_unitario,
      origen: ORIGEN_SALIDA,
      referencia,
      fecha,
      created_by: args.createdBy ?? null,
      usuario_nombre: args.usuarioNombre ?? null,
    });
    if (mov.error) throw new Error(mov.error.message);
  }

  return { ok: true, faltantes: [] };
}

/**
 * Devuelve al stock lo que consumía una línea que se saca de la cuenta.
 *
 * Sólo se puede sacar algo de la última ronda (lo impone `mesas-domain`), así
 * que lo que vuelve es lo que todavía no se preparó.
 */
export async function devolverItem(
  sb: AppSupabaseClient,
  args: {
    empresaId: string;
    sucursalId: string;
    mesa: string;
    mesaId: string;
    item: ItemMesa;
    createdBy?: string | null;
    usuarioNombre?: string | null;
  }
): Promise<void> {
  const cantidadPorProducto = new Map<string, number>([[args.item.producto_id, args.item.cantidad]]);
  const consumo = await calcularConsumo(sb, args.empresaId, args.sucursalId, cantidadPorProducto);

  const fecha = new Date().toISOString();
  const referencia = `${referenciaRonda(args.mesa, args.item.ronda, args.mesaId)} · devolución`;

  for (const s of salidasDeConsumo(consumo, cantidadPorProducto)) {
    const upd = await sb
      .from("productos")
      .update({ stock_actual: s.stock_previo + s.cantidad })
      .eq("id", s.producto_id)
      .eq("empresa_id", args.empresaId);
    if (upd.error) throw new Error(upd.error.message);

    const mov = await sb.from("movimientos_inventario").insert({
      empresa_id: args.empresaId,
      sucursal_id: args.sucursalId,
      producto_id: s.producto_id,
      producto_nombre: s.producto_nombre,
      producto_sku: s.producto_sku,
      tipo: "ENTRADA",
      cantidad: s.cantidad,
      costo_unitario: s.costo_unitario,
      origen: ORIGEN_DEVOLUCION,
      referencia,
      fecha,
      created_by: args.createdBy ?? null,
      usuario_nombre: args.usuarioNombre ?? null,
    });
    if (mov.error) throw new Error(mov.error.message);
  }
}

/**
 * Engancha a la venta los movimientos que dejaron las rondas de esta mesa.
 *
 * Sin esto el kardex muestra salidas sin venta asociada y los reportes que
 * cruzan movimiento con venta las pierden. Es best-effort: la venta ya existe
 * y no se revierte porque esto falle.
 */
export async function vincularMovimientosAVenta(
  sb: AppSupabaseClient,
  args: { empresaId: string; mesaId: string; ventaId: string }
): Promise<void> {
  const { error } = await sb
    .from("movimientos_inventario")
    .update({ venta_id: args.ventaId })
    .eq("empresa_id", args.empresaId)
    .is("venta_id", null)
    .like("referencia", `%· ${args.mesaId}%`);
  if (error) throw new Error(error.message);
}
