import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Lotes de producción y fermentadores.
 *
 * El lote NO duplica la fabricación que ya existe: la envuelve.
 *   · El cocimiento usa `crearProduccionPg`, que descuenta los insumos y da de
 *     alta el producto a granel (el producto en proceso).
 *   · El lote agrega encima el fermentador, las etapas, las fechas y el
 *     envasado, que es donde aparece la merma real.
 *
 * Así el stock y el costo siguen saliendo de un solo lugar.
 */

/** Etapas por las que pasa un lote, en orden. */
export const ETAPAS_LOTE = [
  "planificado",
  "cocimiento",
  "fermentacion",
  "maduracion",
  "carbonatacion",
  "envasado",
  "cerrado",
] as const;

export type EtapaLote = (typeof ETAPAS_LOTE)[number] | "cancelado";

/** Etapas en las que el lote ocupa físicamente el fermentador. */
export const ETAPAS_ACTIVAS: readonly string[] = [
  "cocimiento",
  "fermentacion",
  "maduracion",
  "carbonatacion",
  "envasado",
];

export const ETAPA_LABEL: Record<string, string> = {
  planificado: "Planificado",
  cocimiento: "Cocimiento",
  fermentacion: "Fermentación",
  maduracion: "Maduración",
  carbonatacion: "Carbonatación",
  envasado: "Envasado",
  cerrado: "Cerrado",
  cancelado: "Cancelado",
};

/**
 * Siguiente etapa del flujo normal, o `null` si no hay.
 *
 * El avance es de a una: saltar etapas dejaría el historial sin las fechas que
 * el registro de producción necesita.
 */
export function siguienteEtapa(etapa: string): EtapaLote | null {
  const i = (ETAPAS_LOTE as readonly string[]).indexOf(etapa);
  if (i < 0 || i >= ETAPAS_LOTE.length - 1) return null;
  return ETAPAS_LOTE[i + 1];
}

export type FermentadorRow = {
  id: string;
  empresa_id: string;
  sucursal_id: string;
  codigo: string;
  nombre: string;
  capacidad_litros: number;
  activo: boolean;
  notas: string | null;
};

/** Fermentador con el lote que lo ocupa, si hay alguno. */
export type FermentadorConOcupacion = FermentadorRow & {
  lote_activo_id: string | null;
  lote_activo_codigo: string | null;
  lote_activo_estado: string | null;
};

export type LoteRow = {
  id: string;
  empresa_id: string;
  sucursal_id: string;
  codigo: string;
  receta_id: string | null;
  producto_granel_id: string;
  fermentador_id: string | null;
  estado: string;
  volumen_planificado: number | null;
  volumen_obtenido: number | null;
  volumen_envasado: number;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin: string | null;
  responsable_usuario_id: string | null;
  responsable_nombre: string | null;
  produccion_id: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
};

export type EnvasadoRow = {
  id: string;
  lote_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  litros: number;
  costo_unitario: number;
  fecha: string;
  usuario_nombre: string | null;
};

export type EtapaRow = {
  id: string;
  lote_id: string;
  etapa: string;
  fecha: string;
  usuario_nombre: string | null;
  nota: string | null;
};

// ---------------------------------------------------------------------------
// Fermentadores
// ---------------------------------------------------------------------------

/**
 * Fermentadores de la sucursal con su ocupación actual.
 *
 * La ocupación se deriva del lote activo y no se guarda: una columna "ocupado"
 * se desincroniza en cuanto alguien cancela un lote por otra vía.
 */
export async function listFermentadores(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string
): Promise<FermentadorConOcupacion[]> {
  const { data, error } = await sb
    .from("fermentadores")
    .select("id, empresa_id, sucursal_id, codigo, nombre, capacidad_litros, activo, notas")
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .order("codigo");
  if (error) throw new Error(error.message);
  const fermentadores = (data ?? []) as FermentadorRow[];
  if (fermentadores.length === 0) return [];

  const { data: lotes, error: errLotes } = await sb
    .from("produccion_lotes")
    .select("id, codigo, estado, fermentador_id")
    .eq("empresa_id", empresaId)
    .in("estado", ETAPAS_ACTIVAS)
    .not("fermentador_id", "is", null);
  if (errLotes) throw new Error(errLotes.message);

  const porFermentador = new Map<string, { id: string; codigo: string; estado: string }>();
  for (const l of (lotes ?? []) as Array<{
    id: string;
    codigo: string;
    estado: string;
    fermentador_id: string;
  }>) {
    porFermentador.set(l.fermentador_id, { id: l.id, codigo: l.codigo, estado: l.estado });
  }

  return fermentadores.map((f) => {
    const ocupa = porFermentador.get(f.id) ?? null;
    return {
      ...f,
      lote_activo_id: ocupa?.id ?? null,
      lote_activo_codigo: ocupa?.codigo ?? null,
      lote_activo_estado: ocupa?.estado ?? null,
    };
  });
}

export async function insertFermentador(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  input: { codigo: string; nombre: string; capacidad_litros: number; notas?: string | null }
) {
  const { data, error } = await sb
    .from("fermentadores")
    .insert({
      empresa_id: empresaId,
      sucursal_id: sucursalId,
      codigo: input.codigo,
      nombre: input.nombre,
      capacidad_litros: input.capacidad_litros,
      notas: input.notas ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as FermentadorRow;
}

export async function updateFermentador(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  patch: Partial<{
    codigo: string;
    nombre: string;
    capacidad_litros: number;
    activo: boolean;
    notas: string | null;
  }>
) {
  const { data, error } = await sb
    .from("fermentadores")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as FermentadorRow;
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

export async function listLotes(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string
) {
  const { data, error } = await sb
    .from("produccion_lotes")
    .select(
      "*, fermentadores(codigo, nombre), recetas(nombre), productos:producto_granel_id(nombre, unidad_medida)"
    )
    .eq("empresa_id", empresaId)
    .eq("sucursal_id", sucursalId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as LoteRow),
    fermentador_codigo: (r.fermentadores as { codigo?: string } | null)?.codigo ?? null,
    receta_nombre: (r.recetas as { nombre?: string } | null)?.nombre ?? null,
    producto_granel_nombre: (r.productos as { nombre?: string } | null)?.nombre ?? null,
  }));
}

export async function getLote(sb: AppSupabaseClient, empresaId: string, id: string) {
  const { data, error } = await sb
    .from("produccion_lotes")
    .select(
      "*, fermentadores(codigo, nombre, capacidad_litros), recetas(nombre), productos:producto_granel_id(nombre, unidad_medida, costo_promedio, stock_actual)"
    )
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const prod = r.productos as
    | { nombre?: string; unidad_medida?: string; costo_promedio?: number; stock_actual?: number }
    | null;
  const ferm = r.fermentadores as
    | { codigo?: string; nombre?: string; capacidad_litros?: number }
    | null;
  return {
    ...(r as unknown as LoteRow),
    fermentador_codigo: ferm?.codigo ?? null,
    fermentador_nombre: ferm?.nombre ?? null,
    fermentador_capacidad: ferm?.capacidad_litros ?? null,
    receta_nombre: (r.recetas as { nombre?: string } | null)?.nombre ?? null,
    producto_granel_nombre: prod?.nombre ?? null,
    producto_granel_unidad: prod?.unidad_medida ?? null,
    producto_granel_costo: prod?.costo_promedio ?? 0,
    producto_granel_stock: prod?.stock_actual ?? 0,
  };
}

export async function insertLote(
  sb: AppSupabaseClient,
  empresaId: string,
  sucursalId: string,
  input: {
    codigo: string;
    receta_id: string | null;
    producto_granel_id: string;
    fermentador_id: string | null;
    volumen_planificado: number | null;
    fecha_fin_estimada: string | null;
    responsable_usuario_id: string | null;
    responsable_nombre: string | null;
    observaciones: string | null;
  }
) {
  const { data, error } = await sb
    .from("produccion_lotes")
    .insert({ empresa_id: empresaId, sucursal_id: sucursalId, estado: "planificado", ...input })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as LoteRow;
}

export async function updateLote(
  sb: AppSupabaseClient,
  empresaId: string,
  id: string,
  patch: Record<string, unknown>
) {
  const { data, error } = await sb
    .from("produccion_lotes")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as LoteRow;
}

/** Deja constancia del cambio de etapa: cuándo fue y quién lo registró. */
export async function insertEtapa(
  sb: AppSupabaseClient,
  empresaId: string,
  loteId: string,
  etapa: string,
  usuario: { id?: string | null; nombre?: string | null },
  nota?: string | null
) {
  const { error } = await sb.from("produccion_lote_etapas").insert({
    empresa_id: empresaId,
    lote_id: loteId,
    etapa,
    usuario_id: usuario.id ?? null,
    usuario_nombre: usuario.nombre ?? null,
    nota: nota ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function listEtapas(sb: AppSupabaseClient, loteId: string) {
  const { data, error } = await sb
    .from("produccion_lote_etapas")
    .select("id, lote_id, etapa, fecha, usuario_nombre, nota")
    .eq("lote_id", loteId)
    .order("fecha", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EtapaRow[];
}

export async function listEnvasado(sb: AppSupabaseClient, loteId: string) {
  const { data, error } = await sb
    .from("produccion_lote_envasado")
    .select("id, lote_id, producto_id, producto_nombre, cantidad, litros, costo_unitario, fecha, usuario_nombre")
    .eq("lote_id", loteId)
    .order("fecha", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EnvasadoRow[];
}

/** Formatos de la receta del lote, para saber a qué envases se puede envasar. */
export async function listFormatosDeLote(
  sb: AppSupabaseClient,
  recetaId: string
): Promise<
  Array<{ producto_id: string; producto_nombre: string; capacidad: number; capacidad_unidad: string }>
> {
  const { data, error } = await sb
    .from("receta_formatos")
    .select("producto_id, capacidad, capacidad_unidad, productos(nombre)")
    .eq("receta_id", recetaId)
    .order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    producto_id: String(r.producto_id),
    producto_nombre: (r.productos as { nombre?: string } | null)?.nombre ?? "",
    capacidad: Number(r.capacidad),
    capacidad_unidad: String(r.capacidad_unidad),
  }));
}
