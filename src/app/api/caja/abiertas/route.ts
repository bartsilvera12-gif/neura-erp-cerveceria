import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/response";
import { resolverCtx, respError } from "../_ctx";
import { listarCajasAbiertasParaVenta, sucursalManejaCaja } from "@/lib/caja/server/caja-pg";

/**
 * GET /api/caja/abiertas — cajas 'abierta' de la sucursal (id + número) para el POS.
 *
 * Devuelve además `maneja_caja`: la fábrica factura sin caja, así que una lista
 * vacía no significa lo mismo en las dos sucursales.
 */
export async function GET(request: NextRequest) {
  const r = await resolverCtx(request);
  if (!r.ok) return r.response;
  try {
    const [cajas, maneja_caja] = await Promise.all([
      listarCajasAbiertasParaVenta(r.ctx.schema, r.ctx.empresaId, r.ctx.sucursalId),
      sucursalManejaCaja(r.ctx.schema, r.ctx.empresaId, r.ctx.sucursalId),
    ]);
    return NextResponse.json(successResponse({ cajas, maneja_caja }));
  } catch (e) {
    return respError(e);
  }
}
