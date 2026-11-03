/**
 * El listado de devoluciones.
 *
 * NO HAY UNA TABLA DE DEVOLUCIONES
 * Una devolución es el movimiento de stock que la registró: una ENTRADA con
 * origen `devolucion_venta` atada a la venta. Esa es la única versión de la
 * verdad, y de ahí sale esta lista. Guardar además una fila por devolución
 * sería tener dos registros del mismo hecho esperando a contradecirse.
 *
 * Lo que la pantalla necesita y el movimiento no trae es la PLATA: el
 * movimiento guarda cuánto volvió, no cuánto se le devolvió al cliente. Eso
 * sale del precio que esa venta cobró por ese producto, que es lo que se le
 * devuelve — no el precio de hoy.
 */

export type MovimientoDevolucion = {
  id: string;
  venta_id: string | null;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  fecha: string;
  referencia: string | null;
  usuario_nombre: string | null;
};

export type ItemDevuelto = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  monto: number;
};

export type Devolucion = {
  /** `<venta_id>:<fecha>`: lo que entró junto es una devolución. */
  id: string;
  venta_id: string | null;
  numero_control: string | null;
  fecha: string;
  motivo: string | null;
  usuario_nombre: string | null;
  items: ItemDevuelto[];
  unidades: number;
  monto: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * El motivo que escribió el operador, sin la parte que agrega el sistema.
 *
 * La referencia se guarda como "Devolución FAC-001 · se picó la cerveza": el
 * número ya está en su propia columna, así que repetirlo en la descripción es
 * ruido.
 */
export function motivoDeReferencia(referencia: string | null | undefined): string | null {
  const r = String(referencia ?? "").trim();
  if (!r) return null;
  const i = r.indexOf("·");
  if (i === -1) return null;
  const motivo = r.slice(i + 1).trim();
  return motivo === "" ? null : motivo;
}

/**
 * Junta los movimientos en devoluciones.
 *
 * Lo que se devolvió de una vez comparte venta y hora: eso es UNA devolución,
 * aunque hayan vuelto cuatro productos distintos. Mostrar cada producto como
 * una devolución aparte haría parecer que el cliente vino cuatro veces.
 */
export function agruparDevoluciones(
  movs: MovimientoDevolucion[],
  precios: Map<string, number>,
  numerosPorVenta: Map<string, string>
): Devolucion[] {
  const porGrupo = new Map<string, Devolucion>();

  for (const m of movs) {
    const cantidad = num(m.cantidad);
    if (cantidad <= 0) continue;
    const ventaId = m.venta_id ?? "";
    const clave = `${ventaId}:${m.fecha}`;
    const precio = precios.get(`${ventaId}:${m.producto_id}`) ?? 0;
    const item: ItemDevuelto = {
      producto_id: m.producto_id,
      producto_nombre: m.producto_nombre,
      sku: m.producto_sku,
      cantidad,
      precio_venta: precio,
      monto: Math.round(cantidad * precio),
    };

    const previo = porGrupo.get(clave);
    if (previo) {
      previo.items.push(item);
      previo.unidades += cantidad;
      previo.monto += item.monto;
      continue;
    }
    porGrupo.set(clave, {
      id: clave,
      venta_id: m.venta_id,
      numero_control: ventaId ? numerosPorVenta.get(ventaId) ?? null : null,
      fecha: m.fecha,
      motivo: motivoDeReferencia(m.referencia),
      usuario_nombre: m.usuario_nombre,
      items: [item],
      unidades: cantidad,
      monto: item.monto,
    });
  }

  // La última primero: lo que se devolvió recién es lo que alguien está
  // mirando cuando entra a esta pantalla.
  return [...porGrupo.values()].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

/** Los totales del encabezado. */
export function totalesDevoluciones(devoluciones: Devolucion[]): {
  cantidad: number;
  unidades: number;
  monto: number;
} {
  return devoluciones.reduce(
    (acc, d) => ({
      cantidad: acc.cantidad + 1,
      unidades: acc.unidades + d.unidades,
      monto: acc.monto + d.monto,
    }),
    { cantidad: 0, unidades: 0, monto: 0 }
  );
}
