import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { signProductoImagen } from "@/lib/inventario/imagen-storage";

/**
 * GET /api/mesas/productos — la carta completa de la sucursal, para el mozo.
 *
 * Es la lista ENTERA (hasta 500), no un buscador: en el salón se pide mirando
 * la carta, no tipeando. El buscador del picker filtra sobre lo que ya está
 * cargado, así que no hay una llamada por tecla.
 *
 * Filtra por la SUCURSAL ACTIVA: el bar no vende los barriles de la fábrica ni
 * la fábrica las pizzas del bar.
 */

export type ProductoMesa = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  categoria: string | null;
  imagen_url: string | null;
  controla_stock: boolean;
  /** Sólo en reventa (gaseosa, agua). En lo que se prepara no hay stock propio. */
  stock_actual: number | null;
};

/** Cuántas imágenes se firman. Firmar 500 sería una llamada a storage por cada una. */
const FIRMAR_PRIMERAS = 40;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const sucursalId = exigirSucursal(auth);

    const { data, error } = await sb
      .from("productos")
      .select(
        "id, nombre, sku, precio_venta, stock_actual, controla_stock, imagen_path, imagen_url, categoria_principal_id"
      )
      .eq("empresa_id", auth.empresa_id)
      .eq("sucursal_id", sucursalId)
      .eq("activo", true)
      .eq("es_vendible", true)
      .eq("es_insumo", false)
      .order("nombre", { ascending: true })
      .limit(500);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    type Fila = Record<string, unknown>;
    const filas = (data ?? []) as unknown as Fila[];

    // Nombres de categoría en una sola consulta: son las pestañas del picker.
    const catIds = [
      ...new Set(filas.map((r) => r.categoria_principal_id).filter(Boolean) as string[]),
    ];
    const catPorId = new Map<string, string>();
    if (catIds.length > 0) {
      const cat = await sb.from("categorias_productos").select("id, nombre").in("id", catIds);
      if (!cat.error) {
        for (const c of (cat.data ?? []) as Array<{ id: string; nombre: string | null }>) {
          if (c.nombre) catPorId.set(c.id, c.nombre);
        }
      }
    }

    const firmadas = await Promise.all(
      filas
        .slice(0, FIRMAR_PRIMERAS)
        .map((r) =>
          r.imagen_path ? signProductoImagen(sb, r.imagen_path as string, 3600) : Promise.resolve(null)
        )
    );

    const items: ProductoMesa[] = filas.map((r, i) => {
      const controla = r.controla_stock !== false;
      const catId = (r.categoria_principal_id as string | null) ?? null;
      return {
        id: String(r.id),
        nombre: String(r.nombre ?? ""),
        sku: String(r.sku ?? ""),
        precio_venta: Number(r.precio_venta ?? 0),
        categoria: catId ? catPorId.get(catId) ?? null : null,
        imagen_url: (i < FIRMAR_PRIMERAS ? firmadas[i] : null) ?? ((r.imagen_url as string | null) ?? null),
        controla_stock: controla,
        stock_actual: controla ? Number(r.stock_actual ?? 0) : null,
      };
    });

    return NextResponse.json(successResponse({ items, total: items.length }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/productos]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la carta."), { status: 500 });
  }
}
