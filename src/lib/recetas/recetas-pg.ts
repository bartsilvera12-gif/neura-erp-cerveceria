import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type RecetaRow = {
  id: string;
  empresa_id: string;
  producto_id: string;
  nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  /** Fracción del rendimiento que se pierde en el proceso (0,06 = 6 %). */
  merma_proceso_pct: number;
  notas: string | null;
  activa: boolean;
  created_at: string;
  updated_at: string;
};

export type RecetaItemRow = {
  id: string;
  receta_id: string;
  empresa_id: string;
  insumo_producto_id: string;
  cantidad: number;
  unidad_medida: string | null;
  merma_pct: number;
  orden: number;
};

/** Formato de venta de una receta: barril 30 L, botella 500 ml, etc. */
export type RecetaFormatoRow = {
  id: string;
  receta_id: string;
  empresa_id: string;
  sucursal_id: string;
  producto_id: string;
  capacidad: number;
  capacidad_unidad: string;
  orden: number;
};

/** Un formato, ya costeado por `fn_receta_costeo`. */
export type RecetaFormatoCosteo = {
  formato_id: string;
  producto_id: string;
  producto_nombre: string;
  capacidad: number;
  capacidad_unidad: string;
  orden: number;
  /** La capacidad no es convertible a la unidad de rendimiento (p. ej. kg contra litros). */
  unidad_incompatible: boolean;
  capacidad_en_rendimiento: number | null;
  unidades_por_lote: number | null;
  costo_unitario: number | null;
  precio_venta: number;
  margen_objetivo_pct: number | null;
  /** Precio que daría el margen objetivo. `null` si el producto no tiene uno. */
  precio_sugerido: number | null;
  margen_pct: number | null;
};

export type RecetaCosteo = {
  receta_id: string;
  producto_id: string;
  rendimiento_cantidad: number;
  costo_total: number;
  costo_unitario: number | null;
  precio_venta: number;
  margen_abs: number;
  margen_pct: number | null;
  unidades_posibles: number | null;
  /** Fracción perdida en el proceso (0,06 = 6 %). */
  merma_proceso_pct: number;
  rendimiento_unidad: string | null;
  /** Rendimiento neto de merma: lo que realmente se envasa. */
  rendimiento_envasable: number;
  /** Costo por unidad de rendimiento ENVASABLE. Es el que vale para fijar precios. */
  costo_unitario_envasable: number | null;
  formatos: RecetaFormatoCosteo[];
  items: Array<{
    item_id: string;
    insumo_producto_id: string;
    insumo_nombre: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    costo_promedio: number;
    stock_actual: number;
    subcosto: number;
    unidades_aporte: number | null;
  }>;
  error?: string;
};

export async function listRecetas(sb: AppSupabaseClient, empresaId: string, sucursalId: string) {
  const { data, error } = await sb
    .from("recetas")
    .select("id, producto_id, nombre, rendimiento_cantidad, rendimiento_unidad, activa, updated_at, productos(nombre, sku)")
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  // Aplanar nombre y SKU del producto para búsqueda y fallback de nombre.
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    producto_nombre: (r.productos as { nombre?: string } | null)?.nombre ?? null,
    producto_sku: (r.productos as { sku?: string } | null)?.sku ?? null,
  }));
}

export async function getReceta(sb: AppSupabaseClient, empresaId: string, id: string) {
  const { data, error } = await sb
    .from("recetas")
    .select("*, productos(nombre)")
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as RecetaRow),
    producto_nombre: (row.productos as { nombre?: string } | null)?.nombre ?? null,
  } as RecetaRow & { producto_nombre: string | null };
}

export async function listRecetaItems(sb: AppSupabaseClient, recetaId: string) {
  const { data, error } = await sb
    .from("receta_items")
    .select("id, receta_id, empresa_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden")
    .eq("receta_id", recetaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecetaItemRow[];
}

export async function getRecetaCosteo(
  sb: AppSupabaseClient,
  recetaId: string
): Promise<RecetaCosteo | null> {
  const { data, error } = await sb.rpc("fn_receta_costeo" as never, {
    p_receta_id: recetaId,
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? null) as RecetaCosteo | null;
}

export async function insertReceta(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  input: {
    producto_id: string;
    nombre?: string | null;
    rendimiento_cantidad?: number;
    rendimiento_unidad?: string | null;
    notas?: string | null;
    activa?: boolean;
  }
) {
  const { data, error } = await sb
    .from("recetas")
    .insert({
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      producto_id: input.producto_id,
      nombre: input.nombre ?? null,
      rendimiento_cantidad: input.rendimiento_cantidad ?? 1,
      rendimiento_unidad: input.rendimiento_unidad ?? null,
      notas: input.notas ?? null,
      activa: input.activa ?? true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaRow;
}

export async function updateReceta(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  patch: Partial<{
    nombre: string | null;
    rendimiento_cantidad: number;
    rendimiento_unidad: string | null;
    notas: string | null;
    activa: boolean;
  }>
) {
  const { data, error } = await sb
    .from("recetas")
    .update(patch)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaRow;
}

export async function deleteReceta(sb: AppSupabaseClient, empresaId: string, id: string) {
  const { error } = await sb.from("recetas").delete().eq("empresa_id", empresaId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertRecetaItem(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
  input: {
    insumo_producto_id: string;
    cantidad: number;
    unidad_medida?: string | null;
    merma_pct?: number;
    orden?: number;
  }
) {
  const { data, error } = await sb
    .from("receta_items")
    .insert({
      empresa_id: empresaId,
      receta_id: recetaId,
      insumo_producto_id: input.insumo_producto_id,
      cantidad: input.cantidad,
      unidad_medida: input.unidad_medida ?? null,
      merma_pct: input.merma_pct ?? 0,
      orden: input.orden ?? 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaItemRow;
}

export async function updateRecetaItem(
  sb: AppSupabaseClient,
  itemId: string,
  patch: Partial<{
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    orden: number;
  }>
) {
  const { data, error } = await sb
    .from("receta_items")
    .update(patch)
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaItemRow;
}

export async function deleteRecetaItem(sb: AppSupabaseClient, itemId: string) {
  const { error } = await sb.from("receta_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Productos vendibles SIN receta (para listado en "Crear receta"). */
export async function listProductosVendiblesSinReceta(sb: AppSupabaseClient, empresaId: string) {
  const { data: usados, error: errUsados } = await sb
    .from("recetas")
    .select("producto_id")
    .eq("empresa_id", empresaId);
  if (errUsados) throw new Error(errUsados.message);
  const usadosSet = new Set((usados ?? []).map((r: { producto_id: string }) => r.producto_id));
  // Solo productos elaborados / tipo Menú: vendibles que NO controlan su propio stock
  // (se arman por receta). Excluye reventa (controla_stock=true) y materia prima (es_vendible=false).
  const { data, error } = await sb
    .from("productos")
    .select("id, nombre, sku, precio_venta, unidad_medida")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("es_vendible", true)
    .eq("controla_stock", false)
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []).filter((p: { id: string }) => !usadosSet.has(p.id));
}

export async function listProductos(
  sb: AppSupabaseClient,
  empresaId: string,
  filtro: "vendibles" | "insumos" | "todos"
) {
  let q = sb
    .from("productos")
    .select("id, nombre, sku, precio_venta, costo_promedio, stock_actual, unidad_medida, es_insumo, es_vendible")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("nombre");
  if (filtro === "vendibles") q = q.eq("es_vendible", true);
  if (filtro === "insumos") q = q.eq("es_insumo", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Formatos de venta de una receta, con el nombre y precio del producto.
 * Para los números costeados usar `getRecetaCosteo`, que es la fuente única.
 */
export async function listRecetaFormatos(sb: AppSupabaseClient, recetaId: string) {
  const { data, error } = await sb
    .from("receta_formatos")
    .select("id, receta_id, empresa_id, sucursal_id, producto_id, capacidad, capacidad_unidad, orden, productos(nombre, sku, precio_venta, margen_objetivo_pct)")
    .eq("receta_id", recetaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const prod = r.productos as
      | { nombre?: string; sku?: string; precio_venta?: number; margen_objetivo_pct?: number | null }
      | null;
    return {
      ...(r as unknown as RecetaFormatoRow),
      producto_nombre: prod?.nombre ?? null,
      producto_sku: prod?.sku ?? null,
      precio_venta: prod?.precio_venta ?? 0,
      margen_objetivo_pct: prod?.margen_objetivo_pct ?? null,
    };
  });
}

export async function insertRecetaFormato(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  recetaId: string,
  input: {
    producto_id: string;
    capacidad: number;
    capacidad_unidad: string;
    orden?: number;
  }
) {
  const { data, error } = await sb
    .from("receta_formatos")
    .insert({
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      receta_id: recetaId,
      producto_id: input.producto_id,
      capacidad: input.capacidad,
      capacidad_unidad: input.capacidad_unidad,
      orden: input.orden ?? 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaFormatoRow;
}

export async function updateRecetaFormato(
  sb: AppSupabaseClient,
  formatoId: string,
  patch: Partial<{ capacidad: number; capacidad_unidad: string; orden: number }>
) {
  const { data, error } = await sb
    .from("receta_formatos")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", formatoId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as RecetaFormatoRow;
}

export async function deleteRecetaFormato(sb: AppSupabaseClient, formatoId: string) {
  const { error } = await sb.from("receta_formatos").delete().eq("id", formatoId);
  if (error) throw new Error(error.message);
}

/**
 * Margen objetivo del producto, del que sale el precio sugerido.
 *
 * Vive en `productos` y no en el formato: el objetivo es del producto que se
 * vende, y si mañana se fabrica con otra receta el margen sigue siendo el
 * mismo. Se edita desde la receta porque es ahí donde se ve el costo.
 */
export async function updateMargenObjetivo(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
  margenObjetivoPct: number | null
) {
  const { error } = await sb
    .from("productos")
    .update({ margen_objetivo_pct: margenObjetivoPct })
    .eq("empresa_id", empresaId)
    .eq("id", productoId);
  if (error) throw new Error(error.message);
}

/**
 * Fija el precio de venta del producto de un formato.
 *
 * Existe para cerrar el circuito dentro de la receta: ver el costo, definir el
 * margen y aplicar el precio sin ir a Inventario y volver.
 */
export async function updatePrecioVenta(
  sb: AppSupabaseClient,
  empresaId: string,
  productoId: string,
  precioVenta: number
) {
  const { error } = await sb
    .from("productos")
    .update({ precio_venta: precioVenta })
    .eq("empresa_id", empresaId)
    .eq("id", productoId);
  if (error) throw new Error(error.message);
}
