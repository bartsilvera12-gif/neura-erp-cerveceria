import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { convertirCantidad } from "@/lib/unidades/convert";

/**
 * Qué stock consume vender (o servir) una lista de productos.
 *
 * POR QUE VIVE ACA Y NO DENTRO DE LA VENTA
 * Hay dos momentos en los que se descuenta lo mismo: al confirmar una venta en
 * Caja, y al mandar una ronda a la cocina desde una mesa abierta. Si cada uno
 * hiciera su propia explosión de recetas, la regla del consumo —merma,
 * rendimiento, conversión de unidades— terminaría distinta en los dos lados y
 * el stock del bar no cerraría con el de la fábrica. Acá hay una sola.
 *
 * LAS TRES FORMAS DE CONSUMIR
 *  · Producto con receta activa en modo `preparado_al_vender` (un chop): NO
 *    toca su propio stock; explota la receta y descuenta los insumos.
 *    consumo = cantidad · (1 + merma) / rendimiento, igual que `fn_receta_costeo`.
 *  · `produccion_previa`: descuenta su propio stock del terminado. La materia
 *    prima ya se descontó al fabricar, así que la receta NO se explota.
 *  · `controla_stock = false` sin receta (un servicio): no descuenta nada.
 */

export type FaltanteStock = {
  tipo: "producto" | "insumo";
  producto_id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  solicitado: number;
  faltante: number;
};

export type ProdMeta = {
  stock: number;
  costo: number;
  nombre: string;
  sku: string;
  controlaStock: boolean;
  modo: string;
};

export type InsumoMeta = {
  stock: number;
  costo: number;
  nombre: string;
  sku: string;
  unidad: string | null;
};

export type Consumo = {
  /** Productos del pedido, con su stock y costo actuales. */
  productos: Map<string, ProdMeta>;
  /** producto_id → receta que se explota. Los que están acá NO descuentan su propio stock. */
  recetaByProducto: Map<string, { id: string; rendimiento: number }>;
  /** insumo_producto_id → cantidad a descontar, EN LA UNIDAD DEL INSUMO. */
  insumoNeed: Map<string, number>;
  insumoMeta: Map<string, InsumoMeta>;
  /** Lo que no alcanza. Vacío no significa "hay de todo": los que no controlan stock no entran. */
  faltantes: FaltanteStock[];
  /** Insumos con unidad incompatible: no se pudieron convertir, así que NO se descuentan. */
  incompatibles: string[];
};

/**
 * @param cantidadPorProducto producto_id → cantidad pedida (ya sumada por producto).
 * @throws si un producto no existe o no pertenece a la empresa y sucursal. El
 *   filtro por sucursal no es cosmético: sin él, un producto_id de otra sucursal
 *   descontaría el stock de ESA sucursal.
 */
export async function calcularConsumo(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  cantidadPorProducto: Map<string, number>
): Promise<Consumo> {
  const ids = [...cantidadPorProducto.keys()];
  const productos = new Map<string, ProdMeta>();
  const recetaByProducto = new Map<string, { id: string; rendimiento: number }>();
  const insumoNeed = new Map<string, number>();
  const insumoMeta = new Map<string, InsumoMeta>();
  const incompatibles: string[] = [];
  const faltantes: FaltanteStock[] = [];

  if (ids.length === 0) {
    return { productos, recetaByProducto, insumoNeed, insumoMeta, faltantes, incompatibles };
  }

  const prodQ = await sb
    .from("productos")
    .select("id, stock_actual, costo_promedio, nombre, sku, controla_stock, modo_receta")
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .in("id", ids);
  if (prodQ.error) throw new Error(prodQ.error.message);
  const prodRows = (prodQ.data ?? []) as unknown as Array<{
    id: string;
    stock_actual: number | string;
    costo_promedio: number | string;
    nombre: string;
    sku: string;
    controla_stock: boolean | null;
    modo_receta: string | null;
  }>;
  if (prodRows.length !== ids.length) {
    const found = new Set(prodRows.map((r) => r.id));
    const noEncontrados = ids.filter((id) => !found.has(id));
    throw new Error(
      `Uno o más productos no existen o no pertenecen a esta empresa. IDs no encontrados: ${noEncontrados.join(", ")}`
    );
  }
  for (const r of prodRows) {
    productos.set(r.id, {
      stock: Number(r.stock_actual),
      costo: Number(r.costo_promedio),
      nombre: r.nombre,
      sku: r.sku,
      controlaStock: r.controla_stock !== false,
      modo: r.modo_receta ?? "preparado_al_vender",
    });
  }

  const recetasQ = await sb
    .from("recetas")
    .select("id, producto_id, rendimiento_cantidad")
    .eq("empresa_id", empresaId)
    .eq("activa", true)
    .in("producto_id", ids);
  if (recetasQ.error) throw new Error(recetasQ.error.message);
  const recetaRows = (recetasQ.data ?? []) as unknown as Array<{
    id: string;
    producto_id: string;
    rendimiento_cantidad: number | string | null;
  }>;
  for (const r of recetaRows) {
    // `produccion_previa` NO entra: descuenta su propio terminado y su materia
    // prima ya se fue al fabricar. Agregarlo acá sería descontar dos veces.
    const modo = productos.get(r.producto_id)?.modo ?? "preparado_al_vender";
    if (modo === "produccion_previa") continue;
    const rend = Number(r.rendimiento_cantidad);
    recetaByProducto.set(r.producto_id, { id: r.id, rendimiento: rend > 0 ? rend : 1 });
  }

  if (recetaRows.length > 0) {
    const recetaIds = recetaRows.map((r) => r.id);
    const itemsQ = await sb
      .from("receta_items")
      .select("receta_id, insumo_producto_id, cantidad, unidad_medida, merma_pct")
      .in("receta_id", recetaIds);
    if (itemsQ.error) throw new Error(itemsQ.error.message);

    const itemsByReceta = new Map<
      string,
      Array<{ insumo_producto_id: string; cantidad: number; unidad_item: string | null; merma_pct: number }>
    >();
    const insumoIdsSet = new Set<string>();
    for (const it of (itemsQ.data ?? []) as unknown as Array<{
      receta_id: string;
      insumo_producto_id: string;
      cantidad: number | string;
      unidad_medida: string | null;
      merma_pct: number | string | null;
    }>) {
      const arr = itemsByReceta.get(it.receta_id) ?? [];
      arr.push({
        insumo_producto_id: it.insumo_producto_id,
        cantidad: Number(it.cantidad),
        unidad_item: it.unidad_medida ?? null,
        merma_pct: Number(it.merma_pct ?? 0),
      });
      itemsByReceta.set(it.receta_id, arr);
      insumoIdsSet.add(it.insumo_producto_id);
    }

    const insumoIds = [...insumoIdsSet];
    if (insumoIds.length > 0) {
      const insQ = await sb
        .from("productos")
        .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
        .eq("empresa_id", empresaId)
        .in("id", insumoIds);
      if (insQ.error) throw new Error(insQ.error.message);
      const insRows = (insQ.data ?? []) as unknown as Array<{
        id: string;
        stock_actual: number | string;
        costo_promedio: number | string;
        nombre: string;
        sku: string;
        unidad_medida: string | null;
      }>;
      if (insRows.length !== insumoIds.length) {
        const found = new Set(insRows.map((r) => r.id));
        const faltan = insumoIds.filter((i) => !found.has(i));
        throw new Error(`La receta referencia insumos inexistentes en esta empresa: ${faltan.join(", ")}`);
      }
      for (const r of insRows) {
        insumoMeta.set(r.id, {
          stock: Number(r.stock_actual),
          costo: Number(r.costo_promedio),
          nombre: r.nombre,
          sku: r.sku,
          unidad: r.unidad_medida ?? null,
        });
      }
    }

    for (const [pid, cantidad] of cantidadPorProducto) {
      const rec = recetaByProducto.get(pid);
      if (!rec) continue;
      for (const ri of itemsByReceta.get(rec.id) ?? []) {
        const meta = insumoMeta.get(ri.insumo_producto_id);
        const unidadInsumo = meta?.unidad ?? null;
        // Sin unidad declarada en el ítem o en el insumo → misma unidad, sin conversión.
        const cantConv =
          ri.unidad_item == null || unidadInsumo == null
            ? ri.cantidad
            : convertirCantidad(ri.cantidad, ri.unidad_item, unidadInsumo);
        if (cantConv == null) {
          // Familias de unidad distintas (kg contra litros): no se descuenta
          // nada antes que descontar un número inventado.
          const nombre = meta?.nombre ?? ri.insumo_producto_id;
          if (!incompatibles.includes(nombre)) incompatibles.push(nombre);
          continue;
        }
        const consumo = (cantidad * cantConv * (1 + ri.merma_pct)) / rec.rendimiento;
        if (!(consumo > 0)) continue;
        insumoNeed.set(ri.insumo_producto_id, (insumoNeed.get(ri.insumo_producto_id) ?? 0) + consumo);
      }
    }
  }

  // Redondeo a 6 decimales: la columna es numeric sin escala y el ruido de
  // coma flotante se acumula ronda a ronda.
  for (const [k, v] of insumoNeed) insumoNeed.set(k, Math.round(v * 1e6) / 1e6);

  // Faltantes: productos que descuentan su propio stock…
  for (const [pid, need] of cantidadPorProducto) {
    const p = productos.get(pid)!;
    if (recetaByProducto.has(pid)) continue;
    if (!p.controlaStock && p.modo !== "produccion_previa") continue;
    if (p.stock < need) {
      faltantes.push({
        tipo: "producto",
        producto_id: pid,
        nombre: p.nombre,
        sku: p.sku,
        stock_actual: p.stock,
        solicitado: need,
        faltante: Math.round((need - p.stock) * 1e6) / 1e6,
      });
    }
  }
  // …y materia prima de las recetas.
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    if (m.stock < need) {
      faltantes.push({
        tipo: "insumo",
        producto_id: insId,
        nombre: m.nombre,
        sku: m.sku,
        stock_actual: m.stock,
        solicitado: need,
        faltante: Math.round((need - m.stock) * 1e6) / 1e6,
      });
    }
  }

  return { productos, recetaByProducto, insumoNeed, insumoMeta, faltantes, incompatibles };
}

/** Lo que hay que descontar, ya resuelto: una línea por producto o insumo. */
export type SalidaStock = {
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  cantidad: number;
  costo_unitario: number;
  stock_previo: number;
};

/**
 * Traduce un consumo a la lista de salidas de stock, en el mismo orden en que
 * la venta las aplica: primero los productos que descuentan lo suyo, después
 * los insumos de las recetas.
 */
export function salidasDeConsumo(
  consumo: Consumo,
  cantidadPorProducto: Map<string, number>
): SalidaStock[] {
  const salidas: SalidaStock[] = [];
  for (const [pid, cantidad] of cantidadPorProducto) {
    const p = consumo.productos.get(pid);
    if (!p) continue;
    if (consumo.recetaByProducto.has(pid)) continue;
    if (!p.controlaStock && p.modo !== "produccion_previa") continue;
    salidas.push({
      producto_id: pid,
      producto_nombre: p.nombre,
      producto_sku: p.sku,
      cantidad,
      costo_unitario: p.costo,
      stock_previo: p.stock,
    });
  }
  for (const [insId, need] of consumo.insumoNeed) {
    const m = consumo.insumoMeta.get(insId);
    if (!m) continue;
    salidas.push({
      producto_id: insId,
      producto_nombre: m.nombre,
      producto_sku: m.sku,
      cantidad: need,
      costo_unitario: m.costo,
      stock_previo: m.stock,
    });
  }
  return salidas;
}
