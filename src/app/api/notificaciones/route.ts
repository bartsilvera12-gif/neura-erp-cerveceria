import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  aplicarFiltroSucursales,
  exigirSucursales,
  respuestaSucursalNoAsignada,
} from "@/lib/sucursales/filtro";

/**
 * GET /api/notificaciones — lo que necesita atención ahora, para la campanita.
 *
 * NO ES UN BUZON, ES UN ESTADO
 * No hay "leídas" ni historial: cada aviso existe mientras el problema existe y
 * desaparece solo cuando se resuelve. Un insumo que se repuso deja de avisar
 * sin que nadie lo marque. Para lo contrario —una bandeja con pendientes que
 * alguien va tachando— haría falta otra tabla y otra pantalla.
 *
 * Por ahora la única fuente es el stock bajo mínimo, que es lo que se pidió.
 * La forma de la respuesta admite más fuentes (cuentas vencidas, remisiones
 * esperando aprobación) sin cambiar el front.
 */

export type Notificacion = {
  id: string;
  tipo: "stock_bajo";
  titulo: string;
  detalle: string;
  href: string;
  severidad: "alta" | "media";
};

type ProductoRow = {
  id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number | string | null;
  stock_minimo: number | string | null;
  unidad_medida: string | null;
};

const LIMITE = 50;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;

    // Lectura: en vista consolidada entran las dos sucursales.
    const sucursales = exigirSucursales(auth);

    // El filtro fino (stock <= mínimo) se hace acá y no en SQL porque PostgREST
    // no compara dos columnas entre sí. Se acota antes por `stock_minimo > 0`:
    // un producto sin mínimo cargado no puede estar bajo mínimo, y son la
    // mayoría del catálogo.
    let q = sb
      .from("productos")
      .select("id, nombre, sku, stock_actual, stock_minimo, unidad_medida")
      .eq("empresa_id", auth.empresa_id)
      .eq("activo", true)
      .eq("controla_stock", true)
      .gt("stock_minimo", 0)
      .limit(500);
    q = aplicarFiltroSucursales(q, sucursales);
    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const bajos = ((data ?? []) as ProductoRow[])
      .map((p) => {
        const stock = Number(p.stock_actual) || 0;
        const minimo = Number(p.stock_minimo) || 0;
        return { p, stock, minimo, falta: minimo - stock };
      })
      .filter((x) => x.falta >= 0)
      .sort((a, b) => b.falta - a.falta);

    const items: Notificacion[] = bajos.slice(0, LIMITE).map(({ p, stock, minimo }) => {
      const unidad = (p.unidad_medida ?? "").trim();
      const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
      return {
        id: `stock:${p.id}`,
        tipo: "stock_bajo",
        titulo: p.nombre,
        detalle:
          stock <= 0
            ? `Sin stock · mínimo ${num(minimo)}${unidad ? " " + unidad : ""}`
            : `Quedan ${num(stock)}${unidad ? " " + unidad : ""} · mínimo ${num(minimo)}`,
        href: `/inventario/${p.id}`,
        // Sin stock es otra cosa que estar justo en el mínimo: una frena la
        // producción hoy, la otra avisa para comprar.
        severidad: stock <= 0 ? "alta" : "media",
      };
    });

    return NextResponse.json(successResponse({ total: bajos.length, items }));
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/notificaciones]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las notificaciones."), { status: 500 });
  }
}
