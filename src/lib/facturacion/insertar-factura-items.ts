import type { TasaIvaItem } from "@/lib/facturacion/factura-item-montos";

/**
 * Las líneas de una factura, con su tasa de IVA.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 * `factura_items.tipo_iva` es obligatorio en la base, y cuatro lugares
 * distintos insertaban líneas sin mandarlo: emitir una factura al contado
 * desde el cliente, la factura de una suscripción, la de un cambio de plan y
 * el alta manual. Las cuatro fallaban con un error de la base en crudo
 * ("null value in column tipo_iva...") y la factura quedaba cancelada.
 *
 * La tasa ya se sabía en los cuatro casos: se calculaba para partir el monto
 * en base + IVA y después se tiraba. Acá se guarda, que es lo que el
 * documento electrónico necesita para declarar el IVA de cada línea.
 */

/** Cómo se guarda la tasa en la columna (igual que en `productos.tipo_iva`). */
export function etiquetaTipoIva(tasa: TasaIvaItem | undefined): "EXENTA" | "5%" | "10%" {
  if (tasa === 0) return "EXENTA";
  if (tasa === 5) return "5%";
  return "10%";
}

export type FilaFacturaItem = {
  factura_id: string;
  empresa_id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total: number;
};

type ClienteMinimo = {
  from: (tabla: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (filas: any) => PromiseLike<{ error: { message: string } | null }>;
  };
};

function faltaLaColumna(msg: string): boolean {
  return /tipo_iva/i.test(msg) && /(does not exist|no existe|schema cache|PGRST204|could not find)/i.test(msg);
}

/**
 * Inserta las líneas con su `tipo_iva`.
 *
 * Si una instancia todavía no tiene esa columna, reintenta sin ella: perder el
 * desglose por línea es malo, pero perder la factura entera es peor.
 */
export async function insertarFacturaItems(
  sb: ClienteMinimo,
  filas: FilaFacturaItem[],
  tasa: TasaIvaItem | undefined
): Promise<{ error: string | null }> {
  if (filas.length === 0) return { error: null };
  const tipo = etiquetaTipoIva(tasa);
  const conTipo = filas.map((f) => ({ ...f, tipo_iva: tipo }));

  const primero = await sb.from("factura_items").insert(conTipo);
  if (!primero.error) return { error: null };
  if (!faltaLaColumna(primero.error.message)) return { error: primero.error.message };

  const sinTipo = await sb.from("factura_items").insert(filas);
  return { error: sinTipo.error ? sinTipo.error.message : null };
}
