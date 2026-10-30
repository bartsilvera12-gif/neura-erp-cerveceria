import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { asMetadataObject, getFacturacionEstado } from "@/lib/caja/facturacion";
import { leerItems, rondas, totalMesa, type ItemMesa } from "@/lib/mesas/mesas-domain";

/**
 * Acceso a datos de las mesas abiertas.
 *
 * Una mesa es un pedido (`proyectos`) marcado con `metadata.mesa_abierta`. Se
 * usa el pedido y no una tabla nueva porque la Caja ya sabe cobrarlo: cerrar la
 * mesa es mandar ese mismo pedido a Caja.
 */

export type MesaResumen = {
  id: string;
  mesa: string;
  modalidad: string;
  abierta_at: string;
  items: ItemMesa[];
  rondas: number[];
  total: number;
  /** `pendiente_caja` cuando ya se cerró y espera cobro; `null` mientras está abierta. */
  facturacion_estado: string | null;
  observacion: string | null;
};

type FilaProyecto = {
  id: string;
  titulo?: string | null;
  brief_data?: unknown;
  metadata?: unknown;
  fecha_ingreso?: string | null;
  created_at?: string | null;
};

export function filaAMesa(p: FilaProyecto): MesaResumen {
  const brief = asMetadataObject(p.brief_data);
  const meta = asMetadataObject(p.metadata);
  const items = leerItems(brief.items);
  return {
    id: String(p.id),
    mesa: typeof brief.mesa === "string" ? brief.mesa : "",
    modalidad: typeof brief.modalidad === "string" ? brief.modalidad : "local",
    abierta_at: String(
      (typeof meta.mesa_abierta_at === "string" && meta.mesa_abierta_at) ||
        p.fecha_ingreso ||
        p.created_at ||
        ""
    ),
    items,
    rondas: rondas(items),
    total: totalMesa(items),
    facturacion_estado: getFacturacionEstado(p.metadata),
    observacion: typeof brief.observacion === "string" && brief.observacion.trim() !== "" ? brief.observacion : null,
  };
}

const COLUMNAS = "id, titulo, brief_data, metadata, fecha_ingreso, created_at";

/**
 * Mesas del salón: las abiertas y las que ya se cerraron pero todavía no se
 * cobraron. Una mesa ya facturada o cancelada sale de la lista: su noche
 * terminó, y dejarla visible invita a cobrarla dos veces.
 */
export async function listarMesas(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string
): Promise<MesaResumen[]> {
  const { data, error } = await sb
    .from("proyectos")
    .select(COLUMNAS)
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("archivado", false)
    .eq("metadata->>mesa_abierta", "true")
    .order("fecha_ingreso", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  return ((data ?? []) as FilaProyecto[])
    .map(filaAMesa)
    .filter((m) => m.facturacion_estado !== "facturado" && m.facturacion_estado !== "cancelado_caja");
}

export async function leerMesa(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  id: string
): Promise<{ mesa: MesaResumen; brief: Record<string, unknown>; metadata: Record<string, unknown> } | null> {
  const { data, error } = await sb
    .from("proyectos")
    .select(COLUMNAS)
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const fila = data as FilaProyecto;
  return {
    mesa: filaAMesa(fila),
    brief: asMetadataObject(fila.brief_data),
    metadata: asMetadataObject(fila.metadata),
  };
}

/**
 * Deja en la metadata lo que la ronda acaba de causar:
 *
 *  · `stock_descontado_en_mesa`: el stock ya bajó al servir, así que la venta
 *    de esta mesa se crea con `omitirStock` y no descuenta de nuevo. Se escribe
 *    en cada ronda y no sólo en la primera: si una ronda se cargó antes de que
 *    existiera la marca, la siguiente la deja puesta.
 *  · `rondas_at`: cuándo entró cada ronda. Es lo que la pantalla de comandas
 *    usa para decir hace cuánto espera. Sin esto, una ronda de las 23 en una
 *    mesa abierta a las 21 figuraría esperando dos horas.
 */
export async function marcarRondaEnMesa(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  metadata: Record<string, unknown>,
  ronda: number,
  ahoraIso: string
): Promise<void> {
  const rondasAt =
    metadata.rondas_at != null && typeof metadata.rondas_at === "object"
      ? (metadata.rondas_at as Record<string, unknown>)
      : {};
  const { error } = await sb
    .from("proyectos")
    .update({
      metadata: {
        ...metadata,
        stock_descontado_en_mesa: true,
        rondas_at: { ...rondasAt, [String(ronda)]: ahoraIso },
      },
    })
    .eq("empresa_id", empresaId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Guarda los ítems de la mesa y refresca el monto del pedido. */
export async function guardarItems(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  brief: Record<string, unknown>,
  items: ItemMesa[]
): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await sb
    .from("proyectos")
    .update({
      brief_data: { ...brief, items },
      monto_vendido: totalMesa(items),
      last_activity_at: ahora,
      ultimo_movimiento_at: ahora,
    })
    .eq("empresa_id", empresaId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
