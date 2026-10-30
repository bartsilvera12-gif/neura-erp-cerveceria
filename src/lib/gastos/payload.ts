/**
 * Normalización y validación del payload de un gasto.
 *
 * Vive acá, fuera de las rutas, por dos razones:
 *   · el POST y el PATCH comparten exactamente las mismas reglas, y
 *   · es la única parte del flujo que se puede probar sin base de datos.
 *
 * Lo que entra es `unknown` a propósito: el body de un request no es un
 * `GastoInput` por más que el cliente lo tipe así.
 */

export type MetodoPagoGasto = "efectivo" | "transferencia" | "tarjeta";

/** Fila lista para insertar/actualizar: ya sin strings vacíos ni números disfrazados. */
export type CamposGasto = {
  categoria: string | null;
  descripcion: string | null;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia: string | null;
  fecha: string;
  beneficiario: string | null;
  metodo_pago: MetodoPagoGasto | null;
};

export type ResultadoNormalizacion =
  | { ok: true; campos: Partial<CamposGasto> }
  | { ok: false; error: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function esMetodo(v: unknown): v is MetodoPagoGasto {
  return v === "efectivo" || v === "transferencia" || v === "tarjeta";
}

/**
 * @param parcial `true` para el PATCH: sólo valida lo que vino, y un body sin
 *   ningún campo conocido es un error (un update vacío no hace nada pero
 *   devuelve 200, que es la peor respuesta posible).
 */
export function normalizarGastoInput(
  body: unknown,
  { parcial }: { parcial: boolean }
): ResultadoNormalizacion {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body inválido." };
  }
  const b = body as Record<string, unknown>;
  const campos: Partial<CamposGasto> = {};

  if (b.monto !== undefined) {
    const monto = typeof b.monto === "number" ? b.monto : Number(b.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: "El monto debe ser un número mayor a 0." };
    }
    campos.monto = monto;
  } else if (!parcial) {
    return { ok: false, error: "El monto debe ser un número mayor a 0." };
  }

  if (b.fecha !== undefined) {
    const fecha = String(b.fecha ?? "").trim();
    if (!YMD.test(fecha)) {
      return { ok: false, error: "La fecha es obligatoria y va en formato AAAA-MM-DD." };
    }
    campos.fecha = fecha;
  } else if (!parcial) {
    return { ok: false, error: "La fecha es obligatoria y va en formato AAAA-MM-DD." };
  }

  if (b.tipo !== undefined) {
    if (b.tipo !== "fijo" && b.tipo !== "variable") {
      return { ok: false, error: "El tipo tiene que ser 'fijo' o 'variable'." };
    }
    campos.tipo = b.tipo;
  } else if (!parcial) {
    campos.tipo = "variable";
  }

  if (b.metodo_pago !== undefined) {
    if (b.metodo_pago == null || b.metodo_pago === "") {
      campos.metodo_pago = null;
    } else if (esMetodo(b.metodo_pago)) {
      campos.metodo_pago = b.metodo_pago;
    } else {
      return {
        ok: false,
        error: "El método de pago tiene que ser efectivo, transferencia o tarjeta.",
      };
    }
  } else if (!parcial) {
    campos.metodo_pago = null;
  }

  if (b.recurrente !== undefined) {
    campos.recurrente = b.recurrente === true || b.recurrente === "true";
  } else if (!parcial) {
    campos.recurrente = false;
  }

  for (const k of ["categoria", "descripcion", "frecuencia", "beneficiario"] as const) {
    if (b[k] !== undefined) {
      campos[k] = texto(b[k]);
    } else if (!parcial) {
      campos[k] = null;
    }
  }

  if (parcial && Object.keys(campos).length === 0) {
    return { ok: false, error: "No hay nada que actualizar." };
  }

  return { ok: true, campos };
}
