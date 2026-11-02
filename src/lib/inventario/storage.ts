import { getCurrentUser } from "@/lib/auth";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";
import { getSucursalId } from "@/lib/db/empresa";
import type {
  Producto,
  MovimientoInventario,
  MetodoValuacion,
  TipoMovimiento,
} from "./types";
import { nombreParaRegistro } from "@/lib/auth/nombre-para-registro";

// ─── Tipos de fila Supabase ───────────────────────────────────────────────────

interface ProductoRow {
  id: string;
  empresa_id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;
  precio_mayorista?: number | string | null;
  cantidad_minima_mayorista?: number | string | null;
  precio_distribuidor?: number | string | null;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
  codigo_barras?: string | null;
  codigo_barras_interno?: boolean | null;
  imagen_path?: string | null;
  imagen_url?: string | null;
  categoria_principal_id?: string | null;
  ubicacion_principal_id?: string | null;
  proveedor_principal_id?: string | null;
  es_vendible?: boolean | null;
  es_insumo?: boolean | null;
  controla_stock?: boolean | null;
  valorizado?: boolean | null;
  unidad_compra?: string | null;
  unidad_receta?: string | null;
  factor_compra_receta?: string | number | null;
  tiempo_prep_minutos?: number | null;
  descripcion?: string | null;
  modo_receta?: string | null;
  tipo_iva?: string | null;
}

interface MovimientoRow {
  id: string;
  empresa_id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  tipo: string;
  cantidad: number;
  costo_unitario: number;
  origen: string;
  referencia: string | null;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  usuario_nombre?: string | null;
}

// ─── Mapeo fila → tipo ────────────────────────────────────────────────────────

function rowToProducto(row: ProductoRow): Producto {
  return {
    id: row.id,
    nombre: row.nombre,
    sku: row.sku,
    costo_promedio: Number(row.costo_promedio),
    precio_venta: Number(row.precio_venta),
    precio_mayorista: row.precio_mayorista != null ? Number(row.precio_mayorista) : null,
    cantidad_minima_mayorista: row.cantidad_minima_mayorista != null ? Number(row.cantidad_minima_mayorista) : null,
    precio_distribuidor: row.precio_distribuidor != null ? Number(row.precio_distribuidor) : null,
    stock_actual: Number(row.stock_actual),
    stock_minimo: Number(row.stock_minimo),
    unidad_medida: row.unidad_medida,
    metodo_valuacion: row.metodo_valuacion as MetodoValuacion,
    codigo_barras: row.codigo_barras ?? null,
    codigo_barras_interno: row.codigo_barras_interno ?? false,
    imagen_path: row.imagen_path ?? null,
    imagen_url: row.imagen_url ?? null,
    categoria_principal_id: row.categoria_principal_id ?? null,
    ubicacion_principal_id: row.ubicacion_principal_id ?? null,
    proveedor_principal_id: row.proveedor_principal_id ?? null,
    es_vendible: row.es_vendible ?? true,
    es_insumo: row.es_insumo ?? false,
    controla_stock: row.controla_stock ?? true,
    valorizado: row.valorizado ?? true,
    unidad_compra: row.unidad_compra ?? null,
    unidad_receta: row.unidad_receta ?? null,
    factor_compra_receta: row.factor_compra_receta != null ? Number(row.factor_compra_receta) : 1,
    tiempo_prep_minutos: row.tiempo_prep_minutos != null ? Number(row.tiempo_prep_minutos) : 0,
    descripcion: row.descripcion ?? null,
    modo_receta: row.modo_receta ?? "preparado_al_vender",
    tipo_iva: (row.tipo_iva === "EXENTA" || row.tipo_iva === "5%" ? row.tipo_iva : "10%") as "EXENTA" | "5%" | "10%",
  };
}

function rowToMovimiento(row: MovimientoRow): MovimientoInventario {
  return {
    id: row.id,
    producto_id: row.producto_id,
    producto_nombre: row.producto_nombre,
    producto_sku: row.producto_sku,
    tipo: row.tipo as TipoMovimiento,
    cantidad: Number(row.cantidad),
    costo_unitario: Number(row.costo_unitario),
    origen: row.origen as MovimientoInventario["origen"],
    referencia: row.referencia ?? undefined,
    fecha: row.fecha,
    created_by: row.created_by ?? null,
    usuario_nombre: row.usuario_nombre ?? null,
  };
}

// ─── Productos ─────────────────────────────────────────────────────────────────

/** Lista productos via API server-side (PG directo, soporta tenants erp_* no expuestos). */
export async function getProductos(): Promise<Producto[]> {
  try {
    const r = await fetch("/api/productos", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getProductos:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { productos?: ProductoRow[] }).productos ?? []) as ProductoRow[];
    return list.map(rowToProducto);
  } catch (err) {
    console.error("[inventario] getProductos:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Obtiene un producto por ID via API server-side. */
export async function getProducto(id: string): Promise<Producto | null> {
  try {
    const r = await fetch(`/api/productos/${encodeURIComponent(id)}`, {
      credentials: "include",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getProducto:", (j as { error?: string })?.error ?? r.status);
      return null;
    }
    const row = (j.data as { producto?: ProductoRow }).producto;
    return row ? rowToProducto(row) : null;
  } catch (err) {
    console.error("[inventario] getProducto:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Comprueba si ya existe un producto con el mismo SKU o nombre (case-insensitive).
 * Devuelve el producto encontrado o null.
 */
export async function productoExiste(
  sku: string,
  nombre: string
): Promise<Producto | null> {
  const productos = await getProductos();
  const skuNorm = sku.toLowerCase().trim();
  const nombreNorm = nombre.toLowerCase().trim();
  return (
    productos.find(
      (p) =>
        p.sku.toLowerCase() === skuNorm ||
        p.nombre.toLowerCase() === nombreNorm
    ) ?? null
  );
}

export type NuevoProductoData = Omit<Producto, "id">;

/**
 * Crea producto via API server-side (POST /api/productos).
 *
 * Se mueve a server porque el cliente browser no tiene permisos para leer
 * `zentra_erp.usuarios` (RLS / GRANT) y el patrón canonico del repo es
 * resolver auth + tenant via getTenantSupabaseFromAuth en el backend.
 * El movimiento de inventario_inicial (cuando stock_actual > 0) tambien
 * se hace server-side dentro del mismo handler.
 */
export async function saveProducto(
  datos: NuevoProductoData,
  opts?: { crearEnAmbas?: boolean }
): Promise<Producto | null> {
  const body = {
    crear_en_ambas: opts?.crearEnAmbas === true,
    nombre: datos.nombre,
    sku: datos.sku,
    costo_promedio: datos.costo_promedio,
    precio_venta: datos.precio_venta,
    precio_mayorista: datos.precio_mayorista ?? null,
    cantidad_minima_mayorista: datos.cantidad_minima_mayorista ?? null,
    precio_distribuidor: datos.precio_distribuidor ?? null,
    stock_actual: datos.stock_actual ?? 0,
    stock_minimo: datos.stock_minimo ?? 0,
    unidad_medida: datos.unidad_medida || "Unidad",
    metodo_valuacion: datos.metodo_valuacion,
    codigo_barras:
      datos.codigo_barras !== undefined && datos.codigo_barras !== null && datos.codigo_barras !== ""
        ? datos.codigo_barras
        : null,
    codigo_barras_interno: datos.codigo_barras_interno === true,
    categoria_principal_id: datos.categoria_principal_id ?? null,
    ubicacion_principal_id: datos.ubicacion_principal_id ?? null,
    proveedor_principal_id: datos.proveedor_principal_id ?? null,
    es_vendible: typeof datos.es_vendible === "boolean" ? datos.es_vendible : true,
    es_insumo: typeof datos.es_insumo === "boolean" ? datos.es_insumo : false,
    controla_stock: typeof datos.controla_stock === "boolean" ? datos.controla_stock : true,
    valorizado: typeof datos.valorizado === "boolean" ? datos.valorizado : true,
    unidad_compra: datos.unidad_compra ?? null,
    unidad_receta: datos.unidad_receta ?? null,
    factor_compra_receta:
      typeof datos.factor_compra_receta === "number" && datos.factor_compra_receta > 0
        ? datos.factor_compra_receta
        : 1,
    tiempo_prep_minutos:
      typeof datos.tiempo_prep_minutos === "number" && datos.tiempo_prep_minutos >= 0
        ? datos.tiempo_prep_minutos
        : 0,
    descripcion: datos.descripcion ?? null,
    tipo_iva: datos.tipo_iva ?? "10%",
  };

  const res = await fetch("/api/productos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !json?.success) {
    const msg = (json as { error?: string })?.error ?? `Error ${res.status} al guardar producto.`;
    // 409 (conflicto) o validacion: lanzar para que la UI lo muestre.
    if (res.status === 409 || res.status === 400) throw new Error(msg);
    console.error("[inventario] saveProducto:", msg);
    throw new Error(msg);
  }

  const data = (json.data as { producto?: ProductoRow } | undefined)?.producto;
  if (!data) return null;
  return rowToProducto(data);
}

/** Actualiza solo precio_venta y/o costo_promedio. Wrapper de updateProducto. */
export async function updateProductoPrecios(
  productoId: string,
  datos: { precio_venta?: number; costo_promedio?: number }
): Promise<void> {
  await updateProducto(productoId, datos);
}

/**
 * Actualiza producto via API server-side (PATCH /api/productos/[id]).
 *
 * `motivo_ajuste` no es un campo del producto: es lo que va a decir el kardex
 * si el stock cambió. El servidor registra ese cambio como un AJUSTE, así que
 * el stock nunca se mueve sin un movimiento que lo explique.
 */
export async function updateProducto(
  id: string,
  datos: Partial<Omit<Producto, "id">> & { motivo_ajuste?: string }
): Promise<Producto | null> {
  const body: Record<string, unknown> = {};
  if (datos.nombre !== undefined) body.nombre = datos.nombre;
  if (datos.sku !== undefined) body.sku = datos.sku;
  if (datos.costo_promedio !== undefined) body.costo_promedio = datos.costo_promedio;
  if (datos.precio_venta !== undefined) body.precio_venta = datos.precio_venta;
  if (datos.precio_mayorista !== undefined) body.precio_mayorista = datos.precio_mayorista ?? null;
  if (datos.cantidad_minima_mayorista !== undefined) body.cantidad_minima_mayorista = datos.cantidad_minima_mayorista ?? null;
  if (datos.precio_distribuidor !== undefined) body.precio_distribuidor = datos.precio_distribuidor ?? null;
  if (datos.stock_actual !== undefined) body.stock_actual = datos.stock_actual;
  if (datos.motivo_ajuste !== undefined) body.motivo_ajuste = datos.motivo_ajuste;
  if (datos.stock_minimo !== undefined) body.stock_minimo = datos.stock_minimo;
  if (datos.unidad_medida !== undefined) body.unidad_medida = datos.unidad_medida;
  if (datos.metodo_valuacion !== undefined) body.metodo_valuacion = datos.metodo_valuacion;
  if (datos.codigo_barras !== undefined) body.codigo_barras = datos.codigo_barras ?? null;
  if (datos.codigo_barras_interno !== undefined) body.codigo_barras_interno = datos.codigo_barras_interno;
  if (datos.imagen_path !== undefined) body.imagen_path = datos.imagen_path ?? null;
  if (datos.imagen_url !== undefined) body.imagen_url = datos.imagen_url ?? null;
  if (datos.categoria_principal_id !== undefined) body.categoria_principal_id = datos.categoria_principal_id ?? null;
  if (datos.ubicacion_principal_id !== undefined) body.ubicacion_principal_id = datos.ubicacion_principal_id ?? null;
  if (datos.proveedor_principal_id !== undefined) body.proveedor_principal_id = datos.proveedor_principal_id ?? null;
  if (typeof datos.es_vendible === "boolean") body.es_vendible = datos.es_vendible;
  if (typeof datos.es_insumo === "boolean") body.es_insumo = datos.es_insumo;
  if (typeof datos.controla_stock === "boolean") body.controla_stock = datos.controla_stock;
  if (typeof datos.valorizado === "boolean") body.valorizado = datos.valorizado;
  if (datos.unidad_compra !== undefined) body.unidad_compra = datos.unidad_compra ?? null;
  if (datos.unidad_receta !== undefined) body.unidad_receta = datos.unidad_receta ?? null;
  if (typeof datos.factor_compra_receta === "number" && datos.factor_compra_receta > 0)
    body.factor_compra_receta = datos.factor_compra_receta;
  if (typeof datos.tiempo_prep_minutos === "number" && datos.tiempo_prep_minutos >= 0)
    body.tiempo_prep_minutos = datos.tiempo_prep_minutos;
  if (datos.descripcion !== undefined) body.descripcion = datos.descripcion;
  if (datos.modo_receta !== undefined) body.modo_receta = datos.modo_receta;
  if (datos.tipo_iva !== undefined) body.tipo_iva = datos.tipo_iva;

  const res = await fetch(`/api/productos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !json?.success) {
    const msg = (json as { error?: string })?.error ?? `Error ${res.status} al actualizar producto.`;
    if (res.status === 409 || res.status === 400 || res.status === 404) throw new Error(msg);
    console.error("[inventario] updateProducto:", msg);
    throw new Error(msg);
  }

  const data = (json.data as { producto?: ProductoRow } | undefined)?.producto;
  if (!data) return null;
  return rowToProducto(data);
}

// ─── Movimientos ─────────────────────────────────────────────────────────────

/** Lista movimientos via API server-side (PG directo). */
export async function getMovimientos(): Promise<MovimientoInventario[]> {
  try {
    const r = await fetch("/api/inventario/movimientos", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[inventario] getMovimientos:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { movimientos?: MovimientoRow[] }).movimientos ?? []) as MovimientoRow[];
    return list.map(rowToMovimiento);
  } catch (err) {
    console.error("[inventario] getMovimientos:", err instanceof Error ? err.message : err);
    return [];
  }
}

function calcularDelta(tipo: TipoMovimiento, cantidad: number): number {
  if (tipo === "ENTRADA") return Math.abs(cantidad);
  if (tipo === "SALIDA") return -Math.abs(cantidad);
  return cantidad; // AJUSTE: la cantidad ya lleva el signo
}

export type NuevoMovimientoData = Omit<MovimientoInventario, "id">;

/**
 * El error de la base, en castellano. La regla de "no hay stock negativo" vive
 * en un trigger (script 27), y su mensaje no es para mostrarle a nadie.
 */
function mensajeDeStock(msg: string, nombre: string, hay: number, delta: number): string {
  if (/stock_negativo|stock negativo|23514/i.test(msg)) {
    return `No hay stock suficiente de ${nombre}: hay ${hay} y querés sacar ${Math.abs(delta)}.`;
  }
  return `No se pudo actualizar el stock de ${nombre}.`;
}

/**
 * Registra un movimiento y actualiza stock_actual del producto.
 * empresa_id se obtiene del usuario; RLS valida acceso.
 */
export async function saveMovimiento(
  mov: NuevoMovimientoData
): Promise<MovimientoInventario | null> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const usuario = await getCurrentUser();
  if (!usuario?.empresa_id) throw new Error("Usuario no autenticado o sin empresa");

  // 1. Obtener producto actual
  const producto = await getProducto(mov.producto_id);
  if (!producto) {
    console.error("[inventario] saveMovimiento: producto no encontrado");
    return null;
  }

  const delta = calcularDelta(mov.tipo, mov.cantidad);
  const debeActualizarStock = mov.origen !== "inventario_inicial"; // inventario_inicial ya viene del insert

  /**
   * Una salida no puede llevarse más de lo que hay.
   *
   * Antes esto NO se validaba y el stock se guardaba con `Math.max(0, ...)`:
   * una salida de 50 sobre 35 dejaba el producto en 0 y registraba igual un
   * movimiento de 50. O sea que el kardex decía una cosa y el stock otra, y
   * las 15 unidades de diferencia desaparecían sin que nada avisara.
   *
   * Se valida acá y no sólo en la pantalla porque el stock es el dato que
   * después se vende: la pantalla se puede saltear.
   */
  if (debeActualizarStock && delta < 0 && producto.controla_stock !== false) {
    const disponible = Number(producto.stock_actual) || 0;
    if (disponible + delta < 0) {
      throw new Error(
        `No hay stock suficiente de ${producto.nombre}: hay ${disponible} y querés sacar ${Math.abs(delta)}.`
      );
    }
  }

  /**
   * 2. PRIMERO el stock, DESPUES el movimiento.
   *
   * Antes era al revés, y cuando la base rechazaba el stock (una salida mayor
   * a lo que hay) el movimiento YA estaba escrito: el kardex mostraba una
   * salida que nunca pasó. Con este orden, si el stock no se puede aplicar no
   * queda rastro de nada.
   *
   * El update es condicional sobre el stock que se leyó: si entre la lectura y
   * la escritura otro movimiento tocó el producto, no matchea ninguna fila y se
   * reintenta sobre el valor nuevo. Sin eso, dos movimientos simultáneos se
   * pisan y uno se pierde sin dejar rastro.
   */
  let stockPrevio = producto.stock_actual;
  if (debeActualizarStock) {
    let aplicado = false;
    for (let intento = 0; intento < 4 && !aplicado; intento++) {
      const objetivo = stockPrevio + delta;
      if (objetivo < 0 && producto.controla_stock !== false) {
        throw new Error(
          `No hay stock suficiente de ${producto.nombre}: hay ${stockPrevio} y querés sacar ${Math.abs(delta)}.`
        );
      }
      const { data: updData, error: updError } = await supabase
        .from("productos")
        .update({ stock_actual: objetivo })
        .eq("id", mov.producto_id)
        .eq("stock_actual", stockPrevio)
        .select("id");
      if (updError) {
        // La base tiene la última palabra sobre el stock negativo.
        throw new Error(mensajeDeStock(updError.message, producto.nombre, stockPrevio, delta));
      }
      if (updData && updData.length > 0) {
        aplicado = true;
        break;
      }
      // Nadie matcheó: releer y volver a intentar con el stock actual.
      const refrescado = await getProducto(mov.producto_id);
      if (!refrescado) break;
      stockPrevio = refrescado.stock_actual;
    }
    if (!aplicado) {
      throw new Error(
        `No se pudo aplicar el stock de ${producto.nombre}: alguien más lo está moviendo. Probá de nuevo.`
      );
    }
  }

  // 3. El movimiento, que es lo que explica ese stock
  const insert = {
    empresa_id: usuario.empresa_id,
    sucursal_id: await getSucursalId(),
    producto_id: mov.producto_id,
    producto_nombre: mov.producto_nombre,
    producto_sku: mov.producto_sku,
    tipo: mov.tipo,
    cantidad: mov.cantidad,
    costo_unitario: mov.costo_unitario,
    origen: mov.origen,
    referencia: mov.referencia ?? null,
    fecha: mov.fecha,
    // Sin esto la columna "Usuario" del kardex decía "Sin registro" en todos
    // los movimientos manuales: no se podía auditar quién tocó el stock.
    created_by: usuario.id ?? null,
    usuario_nombre: nombreParaRegistro(usuario),
  };

  const { data: movData, error: movError } = await supabase
    .from("movimientos_inventario")
    .insert([insert])
    .select()
    .single();

  if (movError) {
    // El stock ya se movió: devolverlo, o el producto queda con un stock que
    // ningún movimiento explica — justo lo que esto viene a evitar.
    if (debeActualizarStock) {
      await supabase
        .from("productos")
        .update({ stock_actual: stockPrevio })
        .eq("id", mov.producto_id)
        .eq("stock_actual", stockPrevio + delta);
    }
    console.error("[inventario] saveMovimiento:", movError.message);
    throw new Error("No se pudo registrar el movimiento. El stock quedó como estaba.");
  }

  return rowToMovimiento(movData as MovimientoRow);
}
