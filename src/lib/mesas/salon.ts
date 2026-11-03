/**
 * El salón: las mesas que existen, con lo que está pasando en cada una.
 *
 * POR QUE HAY UN CATALOGO DE MESAS
 * Antes, abrir una cuenta pedía escribir el nombre de la mesa cada vez. En un
 * bar las mesas son siempre las mismas: escribir "5" veinte veces por noche no
 * es cargar un dato, es una traba. Peor, cada quien la escribe como quiere
 * ("5", "Mesa 5", "mesa5") y después el mismo lugar figura como tres mesas
 * distintas.
 *
 * Ahora las mesas se crean una vez y el salón las muestra siempre: libre,
 * ocupada o esperando cobro. Sentarse alguien = tocar la mesa libre.
 *
 * Lo que NO es una mesa —un pedido para llevar— no vive en el catálogo: nace
 * cuando alguien lo pide y desaparece cuando se cobra.
 */

export type MesaCatalogo = {
  id: string;
  nombre: string;
  /** Para agrupar: "Salón", "Terraza", "Barra". Vacío si no se usa. */
  sector: string | null;
  orden: number;
};

export type CuentaAbierta = {
  id: string;
  mesa: string;
  modalidad: string;
  total: number;
  rondas: number[];
  items: Array<{ cantidad: number }>;
  abierta_at: string;
  facturacion_estado: string | null;
};

export type EstadoMesa = "libre" | "ocupada" | "en_caja";

export type MesaSalon = {
  /** Id del catálogo, o el de la cuenta cuando la mesa no está en el catálogo. */
  id: string;
  nombre: string;
  sector: string | null;
  orden: number;
  estado: EstadoMesa;
  /** La cuenta abierta en esa mesa, si hay alguna. */
  cuenta_id: string | null;
  total: number;
  rondas: number;
  unidades: number;
  abierta_at: string | null;
  /** `true` cuando la mesa no está en el catálogo: quedó de una cuenta vieja. */
  fuera_de_catalogo: boolean;
};

/** Mismo criterio que la base: sin mayúsculas ni espacios de más. */
export function claveMesa(nombre: unknown): string {
  return String(nombre ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function datosDeCuenta(c: CuentaAbierta) {
  return {
    cuenta_id: c.id,
    total: num(c.total),
    rondas: c.rondas.length,
    unidades: c.items.reduce((a, i) => a + num(i.cantidad), 0),
    abierta_at: c.abierta_at,
    estado: (c.facturacion_estado === "pendiente_caja" ? "en_caja" : "ocupada") as EstadoMesa,
  };
}

/**
 * Cruza el catálogo con las cuentas abiertas.
 *
 * Una cuenta de una mesa que no está en el catálogo igual se muestra: puede
 * ser de antes de que el catálogo existiera, o de una mesa que alguien borró
 * con gente sentada. Esconderla sería perder plata de vista.
 */
export function armarSalon(
  catalogo: MesaCatalogo[],
  cuentas: CuentaAbierta[]
): { mesas: MesaSalon[]; paraLlevar: MesaSalon[] } {
  const deMesa = cuentas.filter((c) => (c.modalidad ?? "local") === "local");
  const llevar = cuentas.filter((c) => (c.modalidad ?? "local") !== "local");

  const porNombre = new Map<string, CuentaAbierta>();
  for (const c of deMesa) {
    const k = claveMesa(c.mesa);
    // Si por lo que fuera hay dos cuentas en la misma mesa, manda la más vieja:
    // es la que la gente sentada ahí viene arrastrando.
    const previa = porNombre.get(k);
    if (!previa || new Date(c.abierta_at).getTime() < new Date(previa.abierta_at).getTime()) {
      porNombre.set(k, c);
    }
  }

  const mesas: MesaSalon[] = catalogo.map((m) => {
    const cuenta = porNombre.get(claveMesa(m.nombre));
    porNombre.delete(claveMesa(m.nombre));
    const base = {
      id: m.id,
      nombre: m.nombre,
      sector: m.sector,
      orden: m.orden,
      fuera_de_catalogo: false,
    };
    if (!cuenta) {
      return {
        ...base,
        estado: "libre" as EstadoMesa,
        cuenta_id: null,
        total: 0,
        rondas: 0,
        unidades: 0,
        abierta_at: null,
      };
    }
    return { ...base, ...datosDeCuenta(cuenta) };
  });

  // Lo que quedó sin mesa en el catálogo.
  for (const c of porNombre.values()) {
    mesas.push({
      id: c.id,
      nombre: c.mesa,
      sector: null,
      orden: 9999,
      fuera_de_catalogo: true,
      ...datosDeCuenta(c),
    });
  }

  const paraLlevar: MesaSalon[] = llevar.map((c) => ({
    id: c.id,
    nombre: c.mesa,
    sector: null,
    orden: 0,
    fuera_de_catalogo: false,
    ...datosDeCuenta(c),
  }));

  mesas.sort((a, b) => {
    if (a.orden !== b.orden) return a.orden - b.orden;
    return a.nombre.localeCompare(b.nombre, "es", { numeric: true });
  });
  return { mesas, paraLlevar };
}

/** Los números del encabezado del salón. */
export function resumenSalon(mesas: MesaSalon[]): {
  libres: number;
  ocupadas: number;
  en_caja: number;
  total_abierto: number;
} {
  let libres = 0;
  let ocupadas = 0;
  let enCaja = 0;
  let total = 0;
  for (const m of mesas) {
    if (m.estado === "libre") libres += 1;
    else if (m.estado === "en_caja") enCaja += 1;
    else ocupadas += 1;
    total += m.total;
  }
  return { libres, ocupadas, en_caja: enCaja, total_abierto: total };
}
