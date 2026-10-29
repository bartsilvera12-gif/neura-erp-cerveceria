import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  CATEGORIAS_OPERACION,
  type CategoriaOperacion,
  type FormatoEnvasado,
  type LineaOperacion,
  type ParametrosCosteo,
} from "@/lib/recetas/costeo-completo";

/**
 * Lectura y escritura de los dos bloques que el costeo de insumos no cubre:
 * los costos de hacer el lote y los de envasarlo.
 *
 * Acá no se calcula nada. El cálculo es `costearReceta`, que es pura; si
 * además hubiera aritmética en las consultas, el mismo número podría salir
 * distinto según por dónde se pidiera.
 */

const PARAMETROS_POR_DEFECTO: ParametrosCosteo = {
  tarifa_mo_hora_gs: 0,
  margen_mayorista_pct: 0.4,
  margen_directo_pct: 0.45,
};

export async function getParametrosCosteo(
  sb: AppSupabaseClient,
  empresaId: string
): Promise<ParametrosCosteo> {
  const { data, error } = await sb
    .from("costeo_parametros")
    .select("tarifa_mo_hora_gs, margen_mayorista_pct, margen_directo_pct")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ...PARAMETROS_POR_DEFECTO };
  const d = data as Record<string, unknown>;
  return {
    tarifa_mo_hora_gs: Number(d.tarifa_mo_hora_gs ?? 0),
    margen_mayorista_pct: Number(d.margen_mayorista_pct ?? PARAMETROS_POR_DEFECTO.margen_mayorista_pct),
    margen_directo_pct: Number(d.margen_directo_pct ?? PARAMETROS_POR_DEFECTO.margen_directo_pct),
  };
}

export async function guardarParametrosCosteo(
  sb: AppSupabaseClient,
  empresaId: string,
  p: ParametrosCosteo
): Promise<void> {
  const { error } = await sb
    .from("costeo_parametros")
    .upsert(
      {
        empresa_id: empresaId,
        tarifa_mo_hora_gs: p.tarifa_mo_hora_gs,
        margen_mayorista_pct: p.margen_mayorista_pct,
        margen_directo_pct: p.margen_directo_pct,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "empresa_id" }
    );
  if (error) throw new Error(error.message);
}

export type LineaOperacionRow = LineaOperacion & { id: string; nota: string | null; orden: number };

export async function listCostosOperacion(
  sb: AppSupabaseClient,
  recetaId: string
): Promise<LineaOperacionRow[]> {
  const { data, error } = await sb
    .from("receta_costos_operacion")
    .select("id, categoria, concepto, monto_gs, nota, orden")
    .eq("receta_id", recetaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    categoria: (CATEGORIAS_OPERACION as readonly string[]).includes(String(r.categoria))
      ? (r.categoria as CategoriaOperacion)
      : "otros",
    concepto: String(r.concepto ?? ""),
    monto_gs: Number(r.monto_gs ?? 0),
    nota: (r.nota as string) ?? null,
    orden: Number(r.orden ?? 0),
  }));
}

/**
 * Reemplaza TODAS las líneas de la receta por las que llegan.
 *
 * Es un reemplazo y no un diff porque la pantalla edita la lista entera: con
 * un diff, una línea borrada en el navegador y no enviada se quedaría viva en
 * la base y seguiría sumando al costo sin aparecer en ningún lado.
 */
export async function reemplazarCostosOperacion(
  sb: AppSupabaseClient,
  empresaId: string,
  recetaId: string,
  lineas: LineaOperacion[]
): Promise<void> {
  const { error: errDel } = await sb
    .from("receta_costos_operacion")
    .delete()
    .eq("receta_id", recetaId);
  if (errDel) throw new Error(errDel.message);

  const limpias = lineas
    .map((l, i) => ({
      empresa_id: empresaId,
      receta_id: recetaId,
      categoria: (CATEGORIAS_OPERACION as readonly string[]).includes(l.categoria)
        ? l.categoria
        : "otros",
      concepto: String(l.concepto ?? "").trim(),
      monto_gs: Math.max(0, Number(l.monto_gs) || 0),
      orden: i + 1,
    }))
    .filter((l) => l.concepto !== "");
  if (limpias.length === 0) return;

  const { error } = await sb.from("receta_costos_operacion").insert(limpias as never);
  if (error) throw new Error(error.message);
}

/** Lo que `costearReceta` necesita de cada formato, ya resuelto a litros. */
export async function listFormatosEnvasado(
  sb: AppSupabaseClient,
  recetaId: string
): Promise<FormatoEnvasado[]> {
  const { data, error } = await sb
    .from("receta_formatos")
    .select(
      "id, producto_id, capacidad, capacidad_unidad, orden, costo_envase, costo_tapa, " +
        "costo_etiqueta, costo_pack, velocidad_unid_hora, operarios, rendimiento_packaging, " +
        "productos(nombre, precio_venta)"
    )
    .eq("receta_id", recetaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);

  // Las columnas de envasado son nuevas y los tipos generados del cliente
  // todavia no las conocen; por eso la fila se lee como Record.
  const filas = (data ?? []) as unknown as Record<string, unknown>[];
  return filas.map((r) => {
    const prod = r.productos as { nombre?: string; precio_venta?: number } | null;
    return {
      formato_id: String(r.id),
      producto_id: String(r.producto_id),
      producto_nombre: prod?.nombre ?? "Formato sin nombre",
      litros_por_unidad: aLitros(Number(r.capacidad ?? 0), String(r.capacidad_unidad ?? "L")),
      costo_envase: Number(r.costo_envase ?? 0),
      costo_tapa: Number(r.costo_tapa ?? 0),
      costo_etiqueta: Number(r.costo_etiqueta ?? 0),
      costo_pack: Number(r.costo_pack ?? 0),
      velocidad_unid_hora:
        r.velocidad_unid_hora == null ? null : Number(r.velocidad_unid_hora),
      operarios: Number(r.operarios ?? 1),
      rendimiento_packaging: Number(r.rendimiento_packaging ?? 1),
      precio_venta: Number(prod?.precio_venta ?? 0),
    };
  });
}

/**
 * La capacidad se guarda en la unidad con la que se habla del formato (una
 * lata es de 330 ml, no de 0,33 L), pero el lote se mide en litros.
 */
function aLitros(capacidad: number, unidad: string): number {
  const u = unidad.trim().toUpperCase();
  if (u === "ML" || u === "CC") return capacidad / 1000;
  if (u === "HL") return capacidad * 100;
  return capacidad;
}

export type PatchFormatoEnvasado = {
  formato_id: string;
  costo_envase?: number;
  costo_tapa?: number;
  costo_etiqueta?: number;
  costo_pack?: number;
  velocidad_unid_hora?: number | null;
  operarios?: number;
  rendimiento_packaging?: number;
};

export async function guardarFormatosEnvasado(
  sb: AppSupabaseClient,
  recetaId: string,
  cambios: PatchFormatoEnvasado[]
): Promise<void> {
  for (const c of cambios) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["costo_envase", "costo_tapa", "costo_etiqueta", "costo_pack"] as const) {
      if (c[k] != null) patch[k] = Math.max(0, Number(c[k]) || 0);
    }
    if (c.operarios != null) patch.operarios = Math.max(0, Math.trunc(Number(c.operarios) || 0));
    if (c.velocidad_unid_hora !== undefined) {
      const v = c.velocidad_unid_hora == null ? null : Number(c.velocidad_unid_hora);
      // 0 unidades/hora haría divisiones infinitas: se guarda como "sin dato".
      patch.velocidad_unid_hora = v != null && v > 0 ? v : null;
    }
    if (c.rendimiento_packaging != null) {
      const r = Number(c.rendimiento_packaging);
      patch.rendimiento_packaging = r > 0 && r <= 1 ? r : 1;
    }
    if (Object.keys(patch).length === 1) continue;

    const { error } = await sb
      .from("receta_formatos")
      .update(patch as never)
      .eq("id", c.formato_id)
      .eq("receta_id", recetaId); // que un id de otra receta no se cuele
    if (error) throw new Error(error.message);
  }
}
