/**
 * Mediciones de fermentación: densidad, temperatura y pH.
 *
 * Lógica pura, sin base ni red. Lo que importa acá es que los números que se
 * cargan sean los que el cervecero mide, y que el alcohol salga de ellos y no
 * de una estimación escrita a mano.
 */

/** Rangos de lo que puede medir un cervecero. Fuera de esto es un error de tipeo. */
export const RANGO_DENSIDAD = { min: 0.98, max: 1.2 } as const;
export const RANGO_TEMPERATURA = { min: -5, max: 110 } as const;
export const RANGO_PH = { min: 2, max: 10 } as const;

export type Medicion = {
  /** Densidad específica (SG): 1.048, 1.010… */
  densidad: number | null;
  temperatura: number | null;
  ph: number | null;
};

/**
 * Alcohol estimado, en % vol.
 *
 *   ABV ≈ (OG − FG) × 131.25
 *
 * Es la fórmula corta, la que se usa en planta. Para cervezas normales (hasta
 * 8% más o menos) la diferencia con las fórmulas largas es de décimas, y pide
 * sólo los dos números que el cervecero ya mide.
 *
 * Devuelve `null` si falta alguna densidad o si la final es MAYOR que la
 * inicial: eso no es una cerveza con alcohol negativo, es una medición mal
 * cargada, y mostrar un número ahí sería peor que no mostrar nada.
 */
export function abvEstimado(og: number | null | undefined, fg: number | null | undefined): number | null {
  if (og == null || fg == null) return null;
  if (!Number.isFinite(og) || !Number.isFinite(fg)) return null;
  if (fg > og) return null;
  return Math.round((og - fg) * 131.25 * 100) / 100;
}

/**
 * Atenuación aparente, en %: cuánto del azúcar disponible se fermentó.
 *
 *   (OG − FG) / (OG − 1) × 100
 *
 * Es lo que dice si la fermentación terminó o se quedó a mitad de camino.
 */
export function atenuacion(og: number | null | undefined, fg: number | null | undefined): number | null {
  if (og == null || fg == null) return null;
  if (!Number.isFinite(og) || !Number.isFinite(fg)) return null;
  if (og <= 1 || fg > og) return null;
  return Math.round(((og - fg) / (og - 1)) * 1000) / 10;
}

/**
 * De una lista de mediciones (de la más vieja a la más nueva), la primera y la
 * última densidad cargadas: la inicial es la del mosto y la final la del día
 * que se mide para envasar.
 */
export function ogFg(mediciones: Array<{ densidad: number | null }>): { og: number | null; fg: number | null } {
  const conDensidad = mediciones.filter((m) => m.densidad != null) as Array<{ densidad: number }>;
  if (conDensidad.length === 0) return { og: null, fg: null };
  return {
    og: conDensidad[0].densidad,
    // Con una sola medición hay OG pero todavía no FG: la fermentación no
    // terminó, y repetir el mismo número daría 0% de alcohol.
    fg: conDensidad.length > 1 ? conDensidad[conDensidad.length - 1].densidad : null,
  };
}

export type ResultadoValidacion = { ok: true; medicion: Medicion } | { ok: false; error: string };

/** Una medición vacía no sirve: al menos uno de los tres tiene que venir. */
export function validarMedicion(entrada: {
  densidad?: unknown;
  temperatura?: unknown;
  ph?: unknown;
}): ResultadoValidacion {
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  const densidad = num(entrada.densidad);
  const temperatura = num(entrada.temperatura);
  const ph = num(entrada.ph);

  if (Number.isNaN(densidad) || Number.isNaN(temperatura) || Number.isNaN(ph)) {
    return { ok: false, error: "Hay un valor que no es un número." };
  }
  if (densidad == null && temperatura == null && ph == null) {
    return { ok: false, error: "Cargá al menos densidad, temperatura o pH." };
  }
  if (densidad != null && (densidad < RANGO_DENSIDAD.min || densidad > RANGO_DENSIDAD.max)) {
    return {
      ok: false,
      error: `La densidad va entre ${RANGO_DENSIDAD.min} y ${RANGO_DENSIDAD.max} (ej: 1.048). ¿Pusiste 1048?`,
    };
  }
  if (temperatura != null && (temperatura < RANGO_TEMPERATURA.min || temperatura > RANGO_TEMPERATURA.max)) {
    return { ok: false, error: `La temperatura va entre ${RANGO_TEMPERATURA.min} y ${RANGO_TEMPERATURA.max} °C.` };
  }
  if (ph != null && (ph < RANGO_PH.min || ph > RANGO_PH.max)) {
    return { ok: false, error: `El pH va entre ${RANGO_PH.min} y ${RANGO_PH.max}.` };
  }

  return { ok: true, medicion: { densidad, temperatura, ph } };
}
