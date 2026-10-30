import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ymdInicioFinMesLocal } from "@/lib/fechas/calendario";

export type MetodoPagoGasto = "efectivo" | "transferencia" | "tarjeta";

export type Gasto = {
  id: string;
  empresa_id: string;
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  created_at: string;
  /** Nombre del comercio o empresa a la que se le hizo el pago. */
  beneficiario?: string | null;
  /** Cómo se pagó. NULL para gastos históricos sin ese dato. */
  metodo_pago?: MetodoPagoGasto | null;
};

export type GastoInput = {
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  beneficiario?: string | null;
  metodo_pago?: MetodoPagoGasto | null;
};

function mapRow(r: Record<string, unknown>): Gasto {
  const mp = r.metodo_pago;
  const metodo_pago: MetodoPagoGasto | null =
    mp === "efectivo" || mp === "transferencia" || mp === "tarjeta" ? mp : null;
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string,
    categoria: (r.categoria as string) ?? "",
    descripcion: (r.descripcion as string) ?? "",
    monto: Number(r.monto) ?? 0,
    tipo: (r.tipo as "fijo" | "variable") ?? "variable",
    recurrente: Boolean(r.recurrente),
    frecuencia: r.frecuencia as string | undefined,
    fecha: (r.fecha as string) ?? "",
    created_at: (r.created_at as string) ?? "",
    beneficiario: r.beneficiario == null || String(r.beneficiario).trim() === "" ? null : String(r.beneficiario),
    metodo_pago,
  };
}

/**
 * Lee la respuesta de la API de gastos y levanta el mensaje de error del server
 * tal cual, que es el que el usuario necesita leer ("no tenés sucursal
 * asignada", "estás en consolidado", el mensaje de Postgres).
 */
async function pedirGastos<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithSupabaseSession(url, { cache: "no-store", ...init });
  const texto = await res.text().catch(() => "");
  type Cuerpo = { success?: boolean; data?: unknown; error?: string };
  let json: Cuerpo | null = null;
  try {
    json = texto ? (JSON.parse(texto) as Cuerpo) : null;
  } catch {
    json = null;
  }
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || texto || `Error ${res.status}`);
  }
  return json?.data as T;
}

/** Obtiene todos los gastos de la empresa, ordenados por fecha desc. */
export async function getGastos(): Promise<Gasto[]> {
  const data = await pedirGastos<Record<string, unknown>[]>("/api/gastos");
  return (Array.isArray(data) ? data : []).map(mapRow);
}

/** Obtiene los gastos del mes actual (para Dashboard). */
export async function getGastosMesActual(): Promise<Gasto[]> {
  const { inicioYmd, finYmd } = ymdInicioFinMesLocal(new Date());
  const data = await pedirGastos<Record<string, unknown>[]>(
    `/api/gastos?desde=${inicioYmd}&hasta=${finYmd}`
  );
  return (Array.isArray(data) ? data : []).map(mapRow);
}

/**
 * Crea un gasto.
 *
 * Va por la API y no con el cliente del browser por la sucursal: la API usa la
 * sucursal ACTIVA (la del selector de arriba), igual que la lista. Escribiendo
 * desde el browser se usaba `sucursal_predeterminada_id`, así que un usuario
 * parado en una sucursal distinta de su predeterminada creaba el gasto en la
 * otra: se guardaba bien y no aparecía en ninguna pantalla.
 */
export async function createGasto(input: GastoInput): Promise<Gasto> {
  if (input.monto <= 0) throw new Error("El monto debe ser mayor a 0");
  const data = await pedirGastos<Record<string, unknown>>("/api/gastos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return mapRow(data);
}

export async function updateGasto(id: string, input: Partial<GastoInput>): Promise<Gasto> {
  if (input.monto !== undefined && input.monto <= 0) throw new Error("El monto debe ser mayor a 0");
  const data = await pedirGastos<Record<string, unknown>>(`/api/gastos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return mapRow(data);
}

export async function deleteGasto(id: string): Promise<void> {
  await pedirGastos<{ id: string }>(`/api/gastos/${encodeURIComponent(id)}`, { method: "DELETE" });
}
