/**
 * Costeo completo de un lote: insumos + operación + envasado, y el precio
 * sugerido por canal.
 *
 * El costeo que ya existía (`fn_receta_costeo`) suma los insumos y nada más.
 * Eso alcanza para una cocina, donde el envase es una bandeja; no para una
 * cervecería, donde la lata y la etiqueta pueden costar más que la cerveza que
 * llevan adentro, y donde hacer el lote consume dos días de dos personas.
 *
 * Toda la aritmética vive acá, en una función pura, y no en SQL: así se puede
 * probar sin base de datos y el mismo número sale igual en la pantalla, en un
 * informe o en un export.
 *
 * TRES COSAS QUE ESTE MODELO SÍ DISTINGUE Y LA PLANILLA MEZCLABA:
 *
 *  1. Merma de proceso vs. merma de envasado. La primera es del lote (trub,
 *     levadura, trasvases) y se pierde una sola vez. La segunda es de la línea
 *     de envasado y depende del formato: embotellar pierde más que barrilar.
 *  2. Costo del lote vs. costo de la unidad. La operación se reparte entre los
 *     litros que realmente se envasan, no entre los litros brutos.
 *  3. Mayorista vs. venta directa. Son dos márgenes sobre el MISMO costo.
 */

/** Una línea de costo de hacer el lote. El monto es por lote completo. */
export type LineaOperacion = {
  id?: string;
  categoria: CategoriaOperacion;
  concepto: string;
  monto_gs: number;
};

export const CATEGORIAS_OPERACION = ["mano_obra", "energia", "otros"] as const;
export type CategoriaOperacion = (typeof CATEGORIAS_OPERACION)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaOperacion, string> = {
  mano_obra: "Mano de obra",
  energia: "Energía",
  otros: "Agua, CO₂, limpieza y overhead",
};

/** Un formato de venta con lo que cuesta envasarlo. */
export type FormatoEnvasado = {
  formato_id: string;
  producto_id: string;
  producto_nombre: string;
  /** Litros que lleva una unidad de este formato. */
  litros_por_unidad: number;
  costo_envase: number;
  costo_tapa: number;
  costo_etiqueta: number;
  costo_pack: number;
  velocidad_unid_hora: number | null;
  operarios: number;
  rendimiento_packaging: number;
  /** Precio que tiene cargado hoy el producto, para comparar. */
  precio_venta: number;
};

export type ParametrosCosteo = {
  tarifa_mo_hora_gs: number;
  margen_mayorista_pct: number;
  margen_directo_pct: number;
};

export type EntradaCosteo = {
  /** Costo de los insumos del lote, de `fn_receta_costeo`. */
  costo_insumos_gs: number;
  /** Rendimiento bruto del lote y su unidad (litros, en una cervecería). */
  rendimiento: number;
  /** Merma de proceso del lote, 0,08 = 8 %. */
  merma_proceso_pct: number;
  operacion: LineaOperacion[];
  formatos: FormatoEnvasado[];
  parametros: ParametrosCosteo;
};

export type FormatoCosteado = {
  formato_id: string;
  producto_nombre: string;
  litros_por_unidad: number;
  /** Unidades enteras que salen del lote. Las fracciones no se venden. */
  unidades: number;
  /** Litros que terminan dentro de una unidad vendida, ya con la merma de línea. */
  litros_consumidos_por_unidad: number;
  costo_cerveza: number;
  costo_packaging: number;
  costo_mo_envasado: number;
  costo_unitario: number;
  costo_por_litro: number;
  precio_mayorista: number | null;
  precio_directo: number | null;
  precio_venta_actual: number;
  /** Margen real del precio cargado hoy. `null` si todavía no tiene precio. */
  margen_actual_pct: number | null;
};

export type ResultadoCosteo = {
  costo_insumos_gs: number;
  costo_operacion_gs: number;
  operacion_por_categoria: Record<CategoriaOperacion, number>;
  /** Insumos + operación. Es el costo de la cerveza antes de envasarla. */
  costo_lote_gs: number;
  rendimiento: number;
  /** Lo que queda después de la merma de proceso. */
  rendimiento_envasable: number;
  costo_por_litro_envasable: number | null;
  /** Qué porcentaje del costo del lote es cada cosa. Suma 1. */
  composicion: { insumos: number; mano_obra: number; energia: number; otros: number };
  formatos: FormatoCosteado[];
};

function num(v: unknown, porDefecto = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Precio que deja un margen bruto `margen` SOBRE EL PRECIO (no sobre el costo).
 * Es la convención de la planilla y la del rubro: "40 % de margen" quiere decir
 * que 40 de cada 100 Gs facturados son margen, no que se recarga un 40 %.
 */
function precioPorMargen(costo: number, margen: number): number | null {
  if (!(costo > 0)) return null;
  if (!(margen >= 0) || margen >= 1) return null;
  return costo / (1 - margen);
}

export function costearReceta(e: EntradaCosteo): ResultadoCosteo {
  const costoInsumos = Math.max(0, num(e.costo_insumos_gs));

  const porCategoria: Record<CategoriaOperacion, number> = {
    mano_obra: 0,
    energia: 0,
    otros: 0,
  };
  for (const l of e.operacion ?? []) {
    const cat = CATEGORIAS_OPERACION.includes(l.categoria) ? l.categoria : "otros";
    porCategoria[cat] += Math.max(0, num(l.monto_gs));
  }
  const costoOperacion = porCategoria.mano_obra + porCategoria.energia + porCategoria.otros;
  const costoLote = costoInsumos + costoOperacion;

  const rendimiento = Math.max(0, num(e.rendimiento));
  // La merma fuera de rango no se "corrige" a un valor plausible: se ignora,
  // porque un 120 % de merma es un dato roto y no una pérdida enorme.
  const merma = num(e.merma_proceso_pct);
  const mermaOk = merma >= 0 && merma < 1 ? merma : 0;
  const envasable = rendimiento * (1 - mermaOk);
  const costoPorLitro = envasable > 0 ? costoLote / envasable : null;

  const formatos: FormatoCosteado[] = (e.formatos ?? []).map((f) => {
    const litros = Math.max(0, num(f.litros_por_unidad));
    const rendPack = num(f.rendimiento_packaging, 1);
    const rendOk = rendPack > 0 && rendPack <= 1 ? rendPack : 1;

    // Para dejar `litros` dentro de una unidad hay que sacar del tanque algo
    // más, porque parte se pierde en la línea. Eso es lo que cuesta.
    const litrosConsumidos = rendOk > 0 ? litros / rendOk : litros;
    const unidades =
      litrosConsumidos > 0 ? Math.floor(envasable / litrosConsumidos) : 0;

    const costoCerveza = costoPorLitro != null ? costoPorLitro * litrosConsumidos : 0;
    const costoPackaging =
      Math.max(0, num(f.costo_envase)) +
      Math.max(0, num(f.costo_tapa)) +
      Math.max(0, num(f.costo_etiqueta)) +
      Math.max(0, num(f.costo_pack));

    // Mano de obra de envasado: cuántas horas lleva el lote entero en este
    // formato, repartidas entre las unidades que salieron.
    const velocidad = num(f.velocidad_unid_hora, 0);
    const operarios = Math.max(0, num(f.operarios, 1));
    const tarifa = Math.max(0, num(e.parametros?.tarifa_mo_hora_gs));
    const costoMo =
      velocidad > 0 && unidades > 0
        ? ((unidades / velocidad) * operarios * tarifa) / unidades
        : 0;

    const costoUnitario = costoCerveza + costoPackaging + costoMo;
    const precioActual = Math.max(0, num(f.precio_venta));

    return {
      formato_id: f.formato_id,
      producto_nombre: f.producto_nombre,
      litros_por_unidad: litros,
      unidades,
      litros_consumidos_por_unidad: litrosConsumidos,
      costo_cerveza: costoCerveza,
      costo_packaging: costoPackaging,
      costo_mo_envasado: costoMo,
      costo_unitario: costoUnitario,
      costo_por_litro: litros > 0 ? costoUnitario / litros : 0,
      precio_mayorista: precioPorMargen(costoUnitario, num(e.parametros?.margen_mayorista_pct)),
      precio_directo: precioPorMargen(costoUnitario, num(e.parametros?.margen_directo_pct)),
      precio_venta_actual: precioActual,
      margen_actual_pct:
        precioActual > 0 ? ((precioActual - costoUnitario) / precioActual) * 100 : null,
    };
  });

  const d = costoLote > 0 ? costoLote : 1;
  return {
    costo_insumos_gs: costoInsumos,
    costo_operacion_gs: costoOperacion,
    operacion_por_categoria: porCategoria,
    costo_lote_gs: costoLote,
    rendimiento,
    rendimiento_envasable: envasable,
    costo_por_litro_envasable: costoPorLitro,
    composicion: {
      insumos: costoInsumos / d,
      mano_obra: porCategoria.mano_obra / d,
      energia: porCategoria.energia / d,
      otros: porCategoria.otros / d,
    },
    formatos,
  };
}
