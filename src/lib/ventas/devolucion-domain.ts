/**
 * Devolución de productos de una venta ya cobrada.
 *
 * QUE ES Y QUE NO ES
 * Anular una venta es decir que esa venta NO PASÓ: vuelve todo el stock y la
 * venta deja de contar. Una devolución es otra cosa: la venta pasó, el cliente
 * se llevó las cosas, y después trajo parte de vuelta. Las dos cosas mueven
 * stock, pero sólo una borra la venta — por eso no alcanzaba con "anular".
 *
 * LO QUE SE PUEDE DEVOLVER
 * De cada línea, lo vendido menos lo que ya se devolvió antes. Un cliente puede
 * traer de a poco (hoy dos, mañana una), y la cuenta tiene que cerrar igual:
 * nunca se puede devolver más de lo que se llevó, aunque se haga en tres veces.
 *
 * LA PLATA
 * Lo que se devuelve vale lo que se COBRÓ, no el precio de hoy: si el chop
 * subió entre la venta y la devolución, al cliente se le devuelve lo que pagó.
 * Por eso el precio sale de la línea de la venta y no del producto.
 */

export type LineaVendida = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  /** Precio unitario cobrado, IVA incluido. */
  precio_venta: number;
};

export type LineaDevolvible = LineaVendida & {
  /** Cuánto de esta línea ya volvió en devoluciones anteriores. */
  devuelto: number;
  /** Lo que todavía se puede traer de vuelta. */
  devolvible: number;
};

export type ItemADevolver = { producto_id: string; cantidad: number };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Redondeo a guaraní: acá no hay centavos. */
function redondear(n: number): number {
  return Math.round(n);
}

/**
 * Qué queda por devolver de cada línea.
 *
 * `devueltos` es la suma, por producto, de lo que volvió en devoluciones
 * anteriores. Si la venta tiene dos líneas del mismo producto (dos precios
 * distintos, por ejemplo), lo ya devuelto se reparte en orden: primero se
 * descuenta de la primera línea. Cualquier reparto es arbitrario; lo que no
 * puede pasar es que el total devuelto supere al vendido.
 */
export function lineasDevolvibles(
  vendidas: LineaVendida[],
  devueltos: Record<string, number>
): LineaDevolvible[] {
  const restante = new Map<string, number>();
  for (const [pid, cant] of Object.entries(devueltos ?? {})) {
    restante.set(pid, Math.max(0, num(cant)));
  }
  return vendidas.map((l) => {
    const cantidad = Math.max(0, num(l.cantidad));
    const pendiente = restante.get(l.producto_id) ?? 0;
    const devuelto = Math.min(cantidad, pendiente);
    restante.set(l.producto_id, pendiente - devuelto);
    return {
      ...l,
      cantidad,
      precio_venta: num(l.precio_venta),
      devuelto,
      devolvible: Math.max(0, cantidad - devuelto),
    };
  });
}

export type ResultadoValidacion =
  | { ok: true; items: Array<LineaDevolvible & { a_devolver: number; monto: number }>; monto: number }
  | { ok: false; error: string };

/**
 * Comprueba un pedido de devolución contra lo que queda por devolver.
 *
 * Devuelve también cuánta plata es, para que ni la pantalla ni el servidor
 * tengan que volver a multiplicar por su cuenta y terminar con dos totales
 * distintos para la misma devolución.
 */
export function validarDevolucion(
  devolvibles: LineaDevolvible[],
  pedidos: ItemADevolver[]
): ResultadoValidacion {
  const pedidoPorProducto = new Map<string, number>();
  for (const p of pedidos ?? []) {
    const pid = String(p?.producto_id ?? "").trim();
    const cant = num(p?.cantidad);
    if (!pid || cant <= 0) continue;
    pedidoPorProducto.set(pid, (pedidoPorProducto.get(pid) ?? 0) + cant);
  }
  if (pedidoPorProducto.size === 0) {
    return { ok: false, error: "No hay nada para devolver: indicá cuántos vuelven." };
  }

  const items: Array<LineaDevolvible & { a_devolver: number; monto: number }> = [];
  let monto = 0;

  for (const linea of devolvibles) {
    const pendiente = pedidoPorProducto.get(linea.producto_id);
    if (pendiente == null || pendiente <= 0) continue;
    const aDevolver = Math.min(pendiente, linea.devolvible);
    pedidoPorProducto.set(linea.producto_id, pendiente - aDevolver);
    if (aDevolver <= 0) continue;
    const montoLinea = redondear(aDevolver * linea.precio_venta);
    monto += montoLinea;
    items.push({ ...linea, a_devolver: aDevolver, monto: montoLinea });
  }

  // Lo que sobró es lo que se pidió de más: o no estaba en la venta, o ya volvió.
  for (const [pid, sobra] of pedidoPorProducto) {
    if (sobra > 0.0000001) {
      const linea = devolvibles.find((l) => l.producto_id === pid);
      if (!linea) {
        return { ok: false, error: "Hay un producto que no está en esta venta." };
      }
      return {
        ok: false,
        error:
          `De ${linea.producto_nombre} quedan ${linea.devolvible} por devolver` +
          (linea.devuelto > 0 ? ` (ya se devolvieron ${linea.devuelto})` : "") +
          ".",
      };
    }
  }

  if (items.length === 0) {
    return { ok: false, error: "No hay nada para devolver: indicá cuántos vuelven." };
  }
  return { ok: true, items, monto: redondear(monto) };
}

/** Lo que vale lo devuelto hasta ahora, para la ficha de la venta. */
export function totalDevuelto(devolvibles: LineaDevolvible[]): number {
  return redondear(devolvibles.reduce((a, l) => a + l.devuelto * l.precio_venta, 0));
}

/** Una venta devuelta por completo ya no tiene nada que traer de vuelta. */
export function devueltaEntera(devolvibles: LineaDevolvible[]): boolean {
  return devolvibles.length > 0 && devolvibles.every((l) => l.devolvible <= 0);
}

/**
 * El origen con el que se guarda una devolución en el kardex.
 *
 * `anulacion_venta` es el PLAN B: si la base de una instancia no conoce todavía
 * `devolucion_venta`, el movimiento entra igual con el origen viejo antes que
 * perder la devolución. El costo es que después hay que poder reconocerlo, y
 * para eso está la referencia: una devolución siempre arranca con "Devolución",
 * una anulación con "Anulación".
 */
export const ORIGEN_DEVOLUCION = "devolucion_venta";
export const ORIGEN_DEVOLUCION_ALTERNATIVO = "anulacion_venta";

/** Prefijo con el que se escribe la referencia de toda devolución. */
export const REFERENCIA_DEVOLUCION = "Devolución";

/**
 * ¿Este movimiento de entrada es una devolución?
 *
 * Mira el origen y, cuando es el del plan B, la referencia: sin eso, las
 * anulaciones aparecerían en el listado de devoluciones como si el cliente
 * hubiera traído cosas de vuelta, y lo devuelto de una venta se contaría mal.
 */
export function esMovimientoDeDevolucion(
  origen: unknown,
  referencia: unknown
): boolean {
  const o = String(origen ?? "");
  if (o === ORIGEN_DEVOLUCION) return true;
  if (o !== ORIGEN_DEVOLUCION_ALTERNATIVO) return false;
  return String(referencia ?? "")
    .trim()
    .toLowerCase()
    .startsWith(REFERENCIA_DEVOLUCION.toLowerCase());
}
