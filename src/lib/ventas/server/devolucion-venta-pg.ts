import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  lineasDevolvibles,
  validarDevolucion,
  type ItemADevolver,
  type LineaDevolvible,
  type LineaVendida,
} from "@/lib/ventas/devolucion-domain";

/**
 * Devolución de productos de una venta: lo que toca la base.
 *
 * El cliente trajo de vuelta parte de lo que se llevó. La venta SIGUE EXISTIENDO
 * —pasó, se cobró, está en el arqueo del día—; lo que cambia es que las cosas
 * volvieron al stock y hay plata que devolver. Anular es otra cosa y ya existía.
 *
 * Cada devolución deja su rastro como un movimiento de ENTRADA atado a la
 * venta. Eso no es sólo para el kardex: es lo que se suma después para saber
 * cuánto queda por devolver, así nadie devuelve dos veces el mismo chop.
 */

const ORIGEN = "devolucion_venta";
/**
 * Si la base todavía no conoce ese origen (una instancia sin el script 28), se
 * usa el que ya existe para el stock que vuelve de una venta. El movimiento
 * entra igual: perder la devolución por una etiqueta sería mucho peor que
 * verla nombrada como anulación.
 */
const ORIGEN_ALTERNATIVO = "anulacion_venta";

function esOrigenDesconocido(msg: string): boolean {
  return /invalid input value|22P02|check constraint|violates check|23514|origen/i.test(msg);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type VentaParaDevolver = {
  id: string;
  numero_control: string;
  estado: string;
  tipo_venta: string;
  fecha: string | null;
  lineas: LineaDevolvible[];
};

/**
 * La venta con lo que queda por devolver de cada línea.
 *
 * Lo ya devuelto sale de los movimientos, no de una columna aparte: el
 * movimiento es el hecho, y un contador aparte es una segunda versión de la
 * verdad esperando a desincronizarse.
 */
export async function leerVentaParaDevolver(
  sb: AppSupabaseClient,
  empresaId: string,
  ventaId: string
): Promise<VentaParaDevolver | null> {
  const ventaQ = await sb
    .from("ventas")
    .select("id, numero_control, estado, tipo_venta, fecha")
    .eq("empresa_id", empresaId)
    .eq("id", ventaId)
    .maybeSingle();
  if (ventaQ.error) throw new Error(ventaQ.error.message);
  if (!ventaQ.data) return null;
  const venta = ventaQ.data as {
    id: string; numero_control: string; estado: string; tipo_venta: string; fecha: string | null;
  };

  const itemsQ = await sb
    .from("ventas_items")
    .select("producto_id, producto_nombre, sku, cantidad, precio_venta")
    .eq("empresa_id", empresaId)
    .eq("venta_id", ventaId);
  if (itemsQ.error) throw new Error(itemsQ.error.message);
  const vendidas: LineaVendida[] = (itemsQ.data ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return {
      producto_id: String(o.producto_id ?? ""),
      producto_nombre: String(o.producto_nombre ?? ""),
      sku: o.sku == null ? null : String(o.sku),
      cantidad: num(o.cantidad),
      precio_venta: num(o.precio_venta),
    };
  });

  const movsQ = await sb
    .from("movimientos_inventario")
    .select("producto_id, cantidad, origen, tipo")
    .eq("empresa_id", empresaId)
    .eq("venta_id", ventaId)
    .eq("tipo", "ENTRADA");
  if (movsQ.error) throw new Error(movsQ.error.message);

  const devueltos: Record<string, number> = {};
  for (const r of movsQ.data ?? []) {
    const o = r as Record<string, unknown>;
    // Las entradas de una anulación no cuentan como devolución: ahí volvió
    // todo porque la venta dejó de existir.
    if (String(o.origen ?? "") !== ORIGEN) continue;
    const pid = String(o.producto_id ?? "");
    devueltos[pid] = (devueltos[pid] ?? 0) + num(o.cantidad);
  }

  return {
    id: venta.id,
    numero_control: venta.numero_control,
    estado: venta.estado,
    tipo_venta: venta.tipo_venta,
    fecha: venta.fecha,
    lineas: lineasDevolvibles(vendidas, devueltos),
  };
}

export type ResultadoDevolucion =
  | { ok: true; monto: number; devueltos: Array<{ producto_nombre: string; cantidad: number }> }
  | { ok: false; error: string; status: number };

/**
 * Registra la devolución: el stock vuelve y queda el movimiento que lo explica.
 *
 * Si algo falla en el medio, se deshace lo hecho hasta ahí. No hay transacción
 * (esto va por PostgREST), así que el orden importa: por cada producto, primero
 * el stock y después el movimiento, y se guarda qué deshacer.
 */
export async function devolverItemsDeVenta(args: {
  sb: AppSupabaseClient;
  empresaId: string;
  sucursalId: string;
  ventaId: string;
  items: ItemADevolver[];
  motivo: string | null;
  createdBy: string | null;
  usuarioNombre: string | null;
}): Promise<ResultadoDevolucion> {
  const { sb, empresaId, sucursalId, ventaId } = args;

  const venta = await leerVentaParaDevolver(sb, empresaId, ventaId);
  if (!venta) return { ok: false, error: "Esa venta no existe.", status: 404 };
  if (venta.estado === "anulada") {
    return {
      ok: false,
      error: "Esa venta está anulada: ya volvió todo el stock, no hay nada que devolver.",
      status: 409,
    };
  }

  const validacion = validarDevolucion(venta.lineas, args.items);
  if (!validacion.ok) return { ok: false, error: validacion.error, status: 400 };

  const ahora = new Date().toISOString();
  const referencia =
    `Devolución ${venta.numero_control}` + (args.motivo ? ` · ${args.motivo}` : "");

  const hechos: Array<{ producto_id: string; stockPrevio: number; movId: string | null }> = [];

  try {
    for (const item of validacion.items) {
      const prodQ = await sb
        .from("productos")
        .select("id, stock_actual")
        .eq("empresa_id", empresaId)
        .eq("id", item.producto_id)
        .maybeSingle();
      if (prodQ.error) throw new Error(prodQ.error.message);
      // Un producto borrado después de la venta no tiene dónde volver; el
      // resto de la devolución sigue igual.
      if (!prodQ.data) continue;
      const stockPrevio = num((prodQ.data as { stock_actual: unknown }).stock_actual);

      const upd = await sb
        .from("productos")
        .update({ stock_actual: stockPrevio + item.a_devolver })
        .eq("empresa_id", empresaId)
        .eq("id", item.producto_id);
      if (upd.error) throw new Error(upd.error.message);
      hechos.push({ producto_id: item.producto_id, stockPrevio, movId: null });

      const fila = {
        empresa_id: empresaId,
        sucursal_id: sucursalId,
        producto_id: item.producto_id,
        producto_nombre: item.producto_nombre,
        producto_sku: item.sku,
        tipo: "ENTRADA",
        cantidad: item.a_devolver,
        costo_unitario: 0,
        referencia,
        fecha: ahora,
        venta_id: ventaId,
        created_by: args.createdBy,
        usuario_nombre: args.usuarioNombre,
      };
      let ins = await sb
        .from("movimientos_inventario")
        .insert({ ...fila, origen: ORIGEN })
        .select("id")
        .single();
      if (ins.error && esOrigenDesconocido(ins.error.message)) {
        ins = await sb
          .from("movimientos_inventario")
          .insert({ ...fila, origen: ORIGEN_ALTERNATIVO })
          .select("id")
          .single();
      }
      if (ins.error) throw new Error(ins.error.message);
      hechos[hechos.length - 1].movId = String((ins.data as { id: string }).id);
    }

    // Venta a crédito: lo devuelto deja de deberse.
    if (venta.tipo_venta === "CREDITO") {
      const cxcQ = await sb
        .from("cuentas_por_cobrar")
        .select("id, saldo")
        .eq("empresa_id", empresaId)
        .eq("venta_id", ventaId)
        .maybeSingle();
      if (cxcQ.error) throw new Error(cxcQ.error.message);
      if (cxcQ.data) {
        const cxc = cxcQ.data as { id: string; saldo: unknown };
        const saldo = num(cxc.saldo);
        const nuevo = Math.max(0, saldo - validacion.monto);
        const updCxc = await sb
          .from("cuentas_por_cobrar")
          .update({ saldo: nuevo, ...(nuevo === 0 ? { estado: "pagado" } : {}) })
          .eq("empresa_id", empresaId)
          .eq("id", cxc.id);
        if (updCxc.error) throw new Error(updCxc.error.message);
      }
    }

    return {
      ok: true,
      monto: validacion.monto,
      devueltos: validacion.items.map((i) => ({
        producto_nombre: i.producto_nombre,
        cantidad: i.a_devolver,
      })),
    };
  } catch (err) {
    // Deshacer lo que alcanzó a pasar: un stock que volvió sin movimiento que
    // lo explique es justamente lo que este módulo viene a evitar.
    for (const h of hechos.reverse()) {
      if (h.movId) {
        await sb.from("movimientos_inventario").delete().eq("empresa_id", empresaId).eq("id", h.movId);
      }
      await sb
        .from("productos")
        .update({ stock_actual: h.stockPrevio })
        .eq("empresa_id", empresaId)
        .eq("id", h.producto_id);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[devolverItemsDeVenta]", msg);
    return { ok: false, error: "No se pudo registrar la devolución. No quedó nada a medias.", status: 500 };
  }
}
