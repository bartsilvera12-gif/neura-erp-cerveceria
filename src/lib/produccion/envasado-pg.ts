import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { convertirCantidad } from "@/lib/unidades/convert";

/**
 * Envasado de un lote: convierte cerveza a granel en producto terminado.
 *
 * Es la operación que cierra el circuito de producción:
 *   · descuenta del granel los litros que se envasaron
 *   · da de alta las unidades del formato (barriles, botellas)
 *   · deja los dos movimientos de inventario apuntando al lote
 *
 * La diferencia entre lo obtenido en el knockout y lo envasado es la MERMA
 * REAL del lote, que es el dato que el documento de producción pide medir.
 */

/** Se intentó envasar más litros de los que el lote tiene disponibles. */
export class VolumenInsuficienteError extends Error {
  disponible: number;
  solicitado: number;
  constructor(disponible: number, solicitado: number) {
    super(
      `El lote tiene ${disponible} L sin envasar y se intentó envasar ${solicitado} L.`
    );
    this.name = "VolumenInsuficienteError";
    this.disponible = disponible;
    this.solicitado = solicitado;
  }
}

export interface EnvasarParams {
  sb: AppSupabaseClient;
  empresaId: string;
  loteId: string;
  productoId: string;
  cantidad: number;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
}

export interface EnvasarResult {
  envasado_id: string;
  producto_nombre: string;
  cantidad: number;
  litros: number;
  costo_unitario: number;
  volumen_envasado: number;
  merma_litros: number;
}

const redondear = (n: number) => Math.round(n * 1e6) / 1e6;

export async function envasarLote(params: EnvasarParams): Promise<EnvasarResult> {
  const { sb, empresaId, loteId, productoId, cantidad } = params;

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new Error("La cantidad a envasar debe ser mayor a 0.");
  }

  // 1) Lote y granel
  const { data: loteData, error: errLote } = await sb
    .from("produccion_lotes")
    .select("id, estado, receta_id, producto_granel_id, volumen_obtenido, volumen_envasado")
    .eq("empresa_id", empresaId)
    .eq("id", loteId)
    .maybeSingle();
  if (errLote) throw new Error(errLote.message);
  if (!loteData) throw new Error("Lote no encontrado.");

  const lote = loteData as {
    id: string;
    estado: string;
    receta_id: string | null;
    producto_granel_id: string;
    volumen_obtenido: number | null;
    volumen_envasado: number;
  };

  if (lote.estado !== "envasado") {
    throw new Error(
      `El lote está en etapa "${lote.estado}". Pasalo a Envasado antes de registrar envases.`
    );
  }
  if (lote.volumen_obtenido == null || lote.volumen_obtenido <= 0) {
    throw new Error("Cargá primero el volumen obtenido del lote.");
  }

  // 2) Formato: la capacidad sale de la receta, no de lo que mande el cliente.
  if (!lote.receta_id) {
    throw new Error("El lote no tiene receta, así que no se conocen sus formatos.");
  }
  const { data: fmtData, error: errFmt } = await sb
    .from("receta_formatos")
    .select("capacidad, capacidad_unidad, productos(nombre, unidad_medida, stock_actual, costo_promedio)")
    .eq("receta_id", lote.receta_id)
    .eq("producto_id", productoId)
    .maybeSingle();
  if (errFmt) throw new Error(errFmt.message);
  if (!fmtData) throw new Error("Ese producto no es un formato de la receta del lote.");

  const fmt = fmtData as unknown as {
    capacidad: number;
    capacidad_unidad: string;
    productos: {
      nombre: string;
      unidad_medida: string | null;
      stock_actual: number | null;
      costo_promedio: number | null;
    } | null;
  };
  const prodFormato = fmt.productos;
  if (!prodFormato) throw new Error("No se encontró el producto del formato.");

  // 3) Granel
  const { data: granelData, error: errGranel } = await sb
    .from("productos")
    .select("id, nombre, sku, unidad_medida, stock_actual, costo_promedio")
    .eq("empresa_id", empresaId)
    .eq("id", lote.producto_granel_id)
    .maybeSingle();
  if (errGranel) throw new Error(errGranel.message);
  if (!granelData) throw new Error("No se encontró el producto a granel del lote.");
  const granel = granelData as {
    id: string;
    nombre: string;
    sku: string | null;
    unidad_medida: string | null;
    stock_actual: number | null;
    costo_promedio: number | null;
  };

  // 4) Litros que consume este envasado, en la unidad del granel
  const capacidadEnGranel = convertirCantidad(
    fmt.capacidad,
    fmt.capacidad_unidad,
    granel.unidad_medida
  );
  if (capacidadEnGranel == null || capacidadEnGranel <= 0) {
    throw new Error(
      `La capacidad del formato (${fmt.capacidad} ${fmt.capacidad_unidad}) no se puede convertir a ${granel.unidad_medida ?? "la unidad del granel"}.`
    );
  }
  const litros = redondear(cantidad * capacidadEnGranel);

  // 5) No se puede envasar más de lo que se produjo.
  const disponible = redondear(lote.volumen_obtenido - (lote.volumen_envasado ?? 0));
  if (litros > disponible) {
    throw new VolumenInsuficienteError(disponible, litros);
  }

  /**
   * Costo del envase: lo que cuesta el litro de granel por su capacidad. Así
   * todo el costo de los insumos termina repartido entre los envases, en
   * proporción a los litros que se llevan.
   */
  const costoGranelLitro = Number(granel.costo_promedio ?? 0);
  const costoUnitario = redondear(costoGranelLitro * capacidadEnGranel);
  const fechaIso = new Date().toISOString();

  // 6) Registro del envasado. El trigger de la base recalcula `volumen_envasado`.
  const insEnv = await sb
    .from("produccion_lote_envasado")
    .insert({
      lote_id: loteId,
      empresa_id: empresaId,
      producto_id: productoId,
      producto_nombre: prodFormato.nombre,
      cantidad,
      litros,
      costo_unitario: costoUnitario,
      fecha: fechaIso,
      usuario_id: params.usuarioId ?? null,
      usuario_nombre: params.usuarioNombre ?? null,
    })
    .select("id")
    .single();
  if (insEnv.error) throw new Error(insEnv.error.message);
  const envasadoId = String((insEnv.data as { id: string }).id);

  /** Si algo falla después, el envasado no puede quedar registrado sin su stock. */
  const rollback = async () => {
    try {
      await sb.from("produccion_lote_envasado").delete().eq("id", envasadoId);
    } catch {
      /* best-effort: el error original es el que importa */
    }
  };

  try {
    // 7) Salida del granel
    const stockGranel = Number(granel.stock_actual ?? 0);
    const updGranel = await sb
      .from("productos")
      .update({ stock_actual: redondear(Math.max(0, stockGranel - litros)) })
      .eq("empresa_id", empresaId)
      .eq("id", granel.id);
    if (updGranel.error) throw new Error(updGranel.error.message);

    const movSal = await sb.from("movimientos_inventario").insert({
      empresa_id: empresaId,
      producto_id: granel.id,
      producto_nombre: granel.nombre,
      producto_sku: granel.sku,
      tipo: "SALIDA",
      cantidad: litros,
      costo_unitario: costoGranelLitro,
      origen: "envasado",
      fecha: fechaIso,
      lote_id: loteId,
    });
    if (movSal.error) throw new Error(movSal.error.message);

    // 8) Entrada del formato, con costo promedio ponderado
    const stockFmt = Number(prodFormato.stock_actual ?? 0);
    const costoFmtAnt = Number(prodFormato.costo_promedio ?? 0);
    const stockFmtNuevo = redondear(stockFmt + cantidad);
    const costoFmtNuevo =
      stockFmtNuevo > 0
        ? redondear((stockFmt * costoFmtAnt + costoUnitario * cantidad) / stockFmtNuevo)
        : costoUnitario;

    const updFmt = await sb
      .from("productos")
      .update({ stock_actual: stockFmtNuevo, costo_promedio: costoFmtNuevo })
      .eq("empresa_id", empresaId)
      .eq("id", productoId);
    if (updFmt.error) throw new Error(updFmt.error.message);

    const movEnt = await sb.from("movimientos_inventario").insert({
      empresa_id: empresaId,
      producto_id: productoId,
      producto_nombre: prodFormato.nombre,
      tipo: "ENTRADA",
      cantidad,
      costo_unitario: costoUnitario,
      origen: "envasado",
      fecha: fechaIso,
      lote_id: loteId,
    });
    if (movEnt.error) throw new Error(movEnt.error.message);
  } catch (e) {
    await rollback();
    throw e;
  }

  const volumenEnvasado = redondear((lote.volumen_envasado ?? 0) + litros);
  return {
    envasado_id: envasadoId,
    producto_nombre: prodFormato.nombre,
    cantidad,
    litros,
    costo_unitario: costoUnitario,
    volumen_envasado: volumenEnvasado,
    merma_litros: redondear(lote.volumen_obtenido - volumenEnvasado),
  };
}
