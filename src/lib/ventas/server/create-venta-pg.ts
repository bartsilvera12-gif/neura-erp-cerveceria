import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import type { PagosDesglose } from "@/lib/ventas/types";
import { calcularConsumo } from "@/lib/inventario/server/consumo-stock";
import { asuncionYmd } from "@/lib/fecha/asuncion";
import { resolverDestinoPedido } from "@/lib/proyectos/server/destino-pedido";

/** Un faltante de stock detectado al validar la venta. */
export interface FaltanteStock {
  tipo: "producto" | "insumo";
  producto_id: string;
  nombre: string;
  sku: string;
  stock_actual: number;
  solicitado: number;
  faltante: number;
}

/**
 * Se lanza cuando falta stock y NO se autorizó la venta sin stock
 * (`permitir_sin_stock` ausente/false). Lleva el detalle para que la UI
 * muestre el modal de confirmación y reintente con el flag.
 */
export class StockInsuficienteError extends Error {
  faltantes: FaltanteStock[];
  constructor(faltantes: FaltanteStock[]) {
    super("Stock insuficiente para uno o más productos/insumos.");
    this.name = "StockInsuficienteError";
    this.faltantes = faltantes;
  }
}

export interface CreateVentaItemInput {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number;
  precio_venta_original: number;
  precio_venta: number;
  tipo_iva: "EXENTA" | "5%" | "10%";
  tipo_precio: "minorista" | "mayorista" | "distribuidor" | "costo";
  subtotal: number;
  monto_iva: number;
  total_linea: number;
}

export interface CreateVentaPedidoCocinaInput {
  modalidad: "local" | "delivery" | "carry_out";
  mesa: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  direccion_entrega: string | null;
  observacion: string | null;
}

export interface CreateVentaPgParams {
  schema: string;
  empresaId: string;
  /**
   * Sucursal en la que se registra la venta. Obligatoria: de ella dependen los
   * correlativos (VTA-, NR-, FAC-), que son SERIES INDEPENDIENTES por sucursal.
   * Sin esto las dos sucursales compartirían numeración y se interlazarían las
   * series, que es un problema fiscal, no cosmético.
   */
  sucursalId: string;
  clienteId: string | null;
  observaciones: string | null;
  moneda: "GS" | "USD";
  tipoCambio: number;
  tipoVenta: "CONTADO" | "CREDITO";
  plazoDias: number | null;
  /** Fecha de vencimiento explícita (YYYY-MM-DD) para crédito. Si falta, se calcula con plazoDias. */
  fechaVencimiento?: string | null;
  metodoPago: "efectivo" | "tarjeta" | "transferencia" | "mixto" | null;
  /**
   * Reparto del cobro cuando `metodoPago === "mixto"`. Se graba en la MISMA
   * fila de la venta: el arqueo de caja lo lee de ahí, así que no puede quedar
   * sujeto a una escritura posterior que podría fallar.
   */
  pagosDesglose?: PagosDesglose | null;
  items: CreateVentaItemInput[];
  subtotalDeclarado: number;
  montoIvaDeclarado: number;
  totalDeclarado: number;
  pedidoCocina?: CreateVentaPedidoCocinaInput | null;
  /** Si true, autoriza vender aunque falte stock de productos o insumos (stock puede quedar negativo). */
  permitirSinStock?: boolean;
  /**
   * `true` cuando el stock YA se descontó antes de esta venta: una mesa abierta
   * que descontó cada ronda al servirla. La venta entonces cobra, factura y
   * registra todo lo demás, pero no vuelve a tocar el stock ni a validar que
   * alcance — el chop ya salió del granel hace dos horas.
   */
  omitirStock?: boolean;
  /** Si true y hay cliente, la venta emite nota de remisión (documento NO fiscal) con número NR-XXXXXX. */
  generaNotaRemision?: boolean;
  /** Si true (default), la venta activa el puente Venta → Factura ERP: crea
   *  `facturas` FAC-XXXXXX, `factura_items` y linkea `ventas.factura_id`.
   *  Si false, se registra solo la venta (ideal para "solo ticket"), no se
   *  toca `facturas` y `ventas.factura_id` queda null. */
  emitirFactura?: boolean;
  /** Auditoría: usuario que dispara la venta. Se guarda en cada `movimientos_inventario`
   *  para que /inventario/movimientos muestre quién hizo la salida de stock. */
  createdBy?: string | null;
  usuarioNombre?: string | null;
  /** Caja (turno) a la que se imputa la venta. Resuelto en la ruta API según las
   *  cajas abiertas de la sucursal (null = sin caja abierta; la venta igual procede). */
  cajaId?: string | null;
}

function recalcTotals(items: CreateVentaItemInput[]) {
  let subtotal = 0;
  let montoIva = 0;
  let total = 0;
  for (const it of items) {
    subtotal += it.subtotal;
    montoIva += it.monto_iva;
    total += it.total_linea;
  }
  return { subtotal, montoIva, total };
}

const TOL = 2;

/**
 * Crea venta + ítems + movimientos + descuenta stock vía PostgREST/service-role.
 * Sin pool PG directo → compatible con Hostinger Node.js App.
 *
 * Atomicidad: PostgREST no expone transacciones multi-statement. Se hace best-effort:
 * si algún paso post-venta falla, se intenta rollback eliminando venta+items creados.
 * Para una instancia gastronómica de bajo volumen es aceptable.
 *
 * Regla `controla_stock` / recetas:
 *  - Producto con receta activa (Menú elaborado): NO descuenta su propio stock; explota la
 *    receta y descuenta cada insumo/materia prima (consumo = cantidad·(1+merma_pct)/rendimiento,
 *    consistente con fn_receta_costeo), generando un movimiento SALIDA (origen 'venta', ligado por
 *    venta_id) por insumo. Valida disponibilidad de insumos.
 *  - `controla_stock=true` (Reventa, sin receta): valida stock, descuenta stock, genera movimiento.
 *  - `controla_stock=false` (Menú sin receta / servicio): se inserta en ventas_items, NO descuenta.
 */
export async function createVentaTransaccionalPg(
  params: CreateVentaPgParams
): Promise<{
  ventaId: string;
  numeroControl: string;
  fechaIso: string;
  notaRemisionNumero: string | null;
  cuentaPorCobrarId?: string | null;
  facturaId?: string | null;
  numeroFactura?: string | null;
  facturaWarning?: string | null;
}> {
  const items = params.items;
  if (!items.length) {
    throw new Error("La venta debe tener al menos un ítem.");
  }

  const calc = recalcTotals(items);
  if (
    Math.abs(calc.subtotal - params.subtotalDeclarado) > TOL ||
    Math.abs(calc.montoIva - params.montoIvaDeclarado) > TOL ||
    Math.abs(calc.total - params.totalDeclarado) > TOL
  ) {
    throw new Error("Los totales no coinciden con los ítems; revisá el carrito.");
  }

  const qtyByProduct = new Map<string, number>();
  for (const it of items) {
    qtyByProduct.set(it.producto_id, (qtyByProduct.get(it.producto_id) ?? 0) + it.cantidad);
  }

  const sb = createServiceRoleClientWithDbSchema(params.schema);

  // 1) Cliente
  if (params.clienteId) {
    const ck = await sb.from("clientes").select("id").eq("id", params.clienteId).eq("empresa_id", params.empresaId).maybeSingle();
    if (ck.error) throw new Error(ck.error.message);
    if (!ck.data) throw new Error("Cliente no encontrado en esta empresa.");
  }

  // 2) Consumo de stock: qué descuenta esta venta.
  //    La regla (recetas, merma, rendimiento, conversión de unidades) vive en
  //    `calcularConsumo` porque la comparte con las rondas de una mesa abierta:
  //    si cada camino explotara las recetas por su cuenta, el stock del bar
  //    dejaría de cerrar con el de la fábrica.
  const consumo = await calcularConsumo(sb, params.empresaId, params.sucursalId, qtyByProduct);
  const stockMap = consumo.productos;
  const recetaByProducto = consumo.recetaByProducto;
  const insumoNeed = consumo.insumoNeed;
  const insumoMeta = consumo.insumoMeta;
  if (consumo.incompatibles.length > 0) {
    console.warn(
      "[create-venta-pg] receta con unidades incompatibles (no se descuentan):",
      consumo.incompatibles.join(", ")
    );
  }

  // 3) Validar stock. Si la mesa ya descontó (`omitirStock`), no hay nada que
  //    validar: el chop salió del granel cuando se sirvió, no ahora.
  const faltantes: FaltanteStock[] = params.omitirStock ? [] : consumo.faltantes;

  if (faltantes.length > 0 && !params.permitirSinStock) {
    throw new StockInsuficienteError(faltantes);
  }

  // Auditoría: si se autorizó vender sin stock y hubo faltantes, dejar constancia en la venta.
  let observacionesFinal = params.observaciones;
  if (faltantes.length > 0 && params.permitirSinStock) {
    const detalle = faltantes
      .map((f) => `${f.nombre} (stock ${f.stock_actual}, pedido ${f.solicitado}, falta ${f.faltante})`)
      .join("; ");
    const nota = `Venta con stock insuficiente autorizada: ${detalle}`;
    observacionesFinal = (observacionesFinal ? `${observacionesFinal} | ${nota}` : nota).slice(0, 4000);
  }

  // 4) Numero control VTA-XXXXXX. El cálculo (MAX + incremento en memoria) no
  // tiene lock, así que dos requests casi simultáneos pueden calcular el mismo
  // próximo número. El índice único (empresa_id, numero_control) convierte esa
  // carrera en un error de INSERT explícito en vez de un duplicado silencioso;
  // el insert de la venta (paso 5) reintenta recalculando el número si choca.
  const calcularNumeroControl = async (): Promise<string> => {
    const maxQ = await sb
      .from("ventas")
      .select("numero_control")
      .eq("empresa_id", params.empresaId)
      .eq("sucursal_id", params.sucursalId)
      .like("numero_control", "VTA-%")
      .order("numero_control", { ascending: false })
      .limit(1);
    if (maxQ.error) throw new Error(maxQ.error.message);
    let nextNum = 1;
    const lastNum = (maxQ.data?.[0] as { numero_control?: string } | undefined)?.numero_control;
    if (lastNum) {
      const m = lastNum.match(/^VTA-(\d+)$/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    return `VTA-${String(nextNum).padStart(6, "0")}`;
  };
  const fechaIso = new Date().toISOString();

  // 4b) Nota de remisión (solo si se solicita Y hay cliente). Numeración simple por
  //     empresa: NR-XXXXXX. Documento NO fiscal — no toca SIFEN/timbrado.
  const generaNota = params.generaNotaRemision === true && !!params.clienteId;
  let notaRemisionNumero: string | null = null;
  if (generaNota) {
    const nrQ = await sb
      .from("ventas")
      .select("nota_remision_numero")
      .eq("empresa_id", params.empresaId)
      .eq("sucursal_id", params.sucursalId)
      .like("nota_remision_numero", "NR-%")
      .order("nota_remision_numero", { ascending: false })
      .limit(1);
    if (nrQ.error) throw new Error(nrQ.error.message);
    let nextNr = 1;
    const lastNr = (nrQ.data?.[0] as { nota_remision_numero?: string } | undefined)?.nota_remision_numero;
    if (lastNr) {
      const m = lastNr.match(/^NR-(\d+)$/);
      if (m) nextNr = parseInt(m[1], 10) + 1;
    }
    notaRemisionNumero = `NR-${String(nextNr).padStart(6, "0")}`;
  }

  // 5) Insertar venta. Reintenta hasta 3 veces si el numero_control choca con
  // el índice único (carrera con otra venta calculando el mismo próximo número).
  let numeroControl = await calcularNumeroControl();
  let ventaId = "";
  let intentos = 0;
  /**
   * `pagos_desglose` lo agrega el script 10 (pago mixto). Si la instalación
   * todavía no lo corrió, PostgREST rechaza el insert ENTERO — y como la
   * columna viaja en toda venta, aunque sea en null, se cae hasta la venta en
   * efectivo: la caja queda sin poder cobrar nada.
   *
   * Una venta sin pago mixto no necesita esa columna, así que se reintenta sin
   * ella. Una venta MIXTA sí: su reparto es lo que el arqueo usa para saber
   * cuánto efectivo entró, y guardarla sin eso haría cerrar la caja con menos
   * plata de la que hay. Esa se rechaza con un mensaje que dice qué correr.
   */
  let sinDesglose = false;
  for (;;) {
    intentos++;
    const fila: Record<string, unknown> = {
      empresa_id: params.empresaId,
      sucursal_id: params.sucursalId,
      cliente_id: params.clienteId,
      numero_control: numeroControl,
      moneda: params.moneda,
      tipo_cambio: params.tipoCambio,
      subtotal: calc.subtotal,
      monto_iva: calc.montoIva,
      total: calc.total,
      estado: "completada",
      tipo_venta: params.tipoVenta,
      plazo_dias: params.plazoDias,
      metodo_pago: params.metodoPago,
      pagos_desglose: params.metodoPago === "mixto" ? (params.pagosDesglose ?? null) : null,
      genera_nota_remision: generaNota,
      nota_remision_numero: notaRemisionNumero,
      fecha: fechaIso,
      observaciones: observacionesFinal,
      caja_id: params.cajaId ?? null,
    };
    if (sinDesglose) delete fila.pagos_desglose;

    const insVenta = await sb.from("ventas").insert(fila).select("id").single();
    if (!insVenta.error) {
      ventaId = String((insVenta.data as { id: string }).id);
      break;
    }
    const msg = insVenta.error.message ?? "";

    const faltaDesglose =
      !sinDesglose &&
      /pagos_desglose/.test(msg) &&
      ((insVenta.error as { code?: string }).code === "PGRST204" ||
        /could not find|schema cache|does not exist/i.test(msg));
    if (faltaDesglose) {
      if (params.metodoPago === "mixto") {
        throw new Error(
          "El cobro mixto todavía no está habilitado en la base: falta la columna " +
            "`pagos_desglose` en ventas. Corré el script 10 (10_pago_mixto.sql) y " +
            "volvé a intentar. Mientras tanto se puede cobrar con un solo método."
        );
      }
      console.warn(
        "[ventas] falta ventas.pagos_desglose (correr 10_pago_mixto.sql); " +
          "la venta se registra sin esa columna."
      );
      sinDesglose = true;
      intentos--; // este intento no gastó número de control
      continue;
    }

    const esConflictoNumero =
      (insVenta.error as { code?: string }).code === "23505" || /duplicate key|unique/i.test(msg);
    if (!esConflictoNumero || intentos >= 3) throw new Error(msg);
    numeroControl = await calcularNumeroControl();
  }

  // stock_actual previo a cada decremento (productos e insumos), para poder
  // restaurarlo si algún paso posterior falla. Mismo patrón que
  // anular-venta-core.ts: se guarda el valor ANTES de escribir el nuevo, así
  // el rollback es una simple restauración, no un cálculo de delta.
  const stockPrevio: Array<{ producto_id: string; stock_actual: number }> = [];

  // Helper de rollback best-effort
  const rollback = async () => {
    // Restaurar stock ANTES de borrar movimientos/venta: si esto falla a
    // mitad de camino, preferimos dejar rastro (movimiento + venta huérfana)
    // antes que perder silenciosamente el stock descontado.
    for (const s of stockPrevio) {
      try {
        await sb
          .from("productos")
          .update({ stock_actual: s.stock_actual })
          .eq("id", s.producto_id)
          .eq("empresa_id", params.empresaId);
      } catch {}
    }
    try {
      await sb.from("cuentas_por_cobrar").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("movimientos_inventario").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("ventas_items").delete().eq("venta_id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("ventas").delete().eq("id", ventaId).eq("empresa_id", params.empresaId);
    } catch {}
  };

  try {
    // 6) Insertar items (bulk)
    const itemsRows = items.map((line) => ({
      empresa_id: params.empresaId,
      venta_id: ventaId,
      producto_id: line.producto_id,
      producto_nombre: line.producto_nombre,
      sku: line.sku,
      cantidad: line.cantidad,
      precio_venta_original: line.precio_venta_original,
      precio_venta: line.precio_venta,
      tipo_iva: line.tipo_iva,
      tipo_precio: line.tipo_precio,
      subtotal: line.subtotal,
      monto_iva: line.monto_iva,
      total_linea: line.total_linea,
    }));
    const insItems = await sb.from("ventas_items").insert(itemsRows);
    if (insItems.error) throw new Error(insItems.error.message);

    // 7) Descuento de stock + movimientos solo para productos con controla_stock=true SIN receta.
    //    `omitirStock`: la mesa ya descontó al servir cada ronda. Descontar de
    //    nuevo acá dejaría el stock en la mitad de lo que hay en la heladera.
    for (const line of params.omitirStock ? [] : items) {
      const p = stockMap.get(line.producto_id)!;
      if (recetaByProducto.has(line.producto_id)) continue;
      // produccion_previa: descuenta su propio stock del terminado aunque controla_stock=false.
      if (!p.controlaStock && p.modo !== "produccion_previa") continue;
      // El stock nunca baja de 0: si se vendió sin stock, queda en 0 (la cantidad real
      // vendida queda registrada en el movimiento SALIDA, así no se pierde trazabilidad).
      const nuevoStock = Math.max(0, p.stock - line.cantidad);
      stockPrevio.push({ producto_id: line.producto_id, stock_actual: p.stock });
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", line.producto_id)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      p.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        sucursal_id: params.sucursalId,
        producto_id: line.producto_id,
        producto_nombre: line.producto_nombre,
        producto_sku: line.sku,
        tipo: "SALIDA",
        cantidad: line.cantidad,
        costo_unitario: p.costo,
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.createdBy ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 7b) Descontar materia prima (insumos) por explosión de receta + movimiento SALIDA por insumo.
    for (const [insId, need] of params.omitirStock ? new Map<string, number>() : insumoNeed) {
      const m = insumoMeta.get(insId)!;
      // Igual que productos: el stock de insumos nunca baja de 0 (la salida real
      // queda registrada en el movimiento SALIDA del insumo).
      const nuevoStock = Math.max(0, m.stock - need);
      stockPrevio.push({ producto_id: insId, stock_actual: m.stock });
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", insId)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      m.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        sucursal_id: params.sucursalId,
        producto_id: insId,
        producto_nombre: m.nombre,
        producto_sku: m.sku,
        tipo: "SALIDA",
        cantidad: need,
        costo_unitario: m.costo,
        // origen restringido por CHECK a compra|venta|ajuste_manual|inventario_inicial.
        // El consumo de insumo lo causa una venta → 'venta' (se distingue por venta_id + producto insumo).
        origen: "venta",
        referencia: numeroControl,
        fecha: fechaIso,
        venta_id: ventaId,
        created_by: params.createdBy ?? null,
        usuario_nombre: params.usuarioNombre ?? null,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 8) Pedido cocina (tarjeta en proyectos)
    if (params.pedidoCocina) {
      // Tipo de proyecto y columna inicial del tablero (ver destino-pedido.ts).
      const { tipoId, estadoId } = await resolverDestinoPedido(sb, params.empresaId);

      const itemsSnapshot = items.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        sku: it.sku,
        cantidad: it.cantidad,
        precio_venta: it.precio_venta,
        total_linea: it.total_linea,
      }));
      const briefData = {
        modalidad: params.pedidoCocina.modalidad,
        mesa: params.pedidoCocina.mesa,
        cliente_nombre: params.pedidoCocina.cliente_nombre,
        cliente_telefono: params.pedidoCocina.cliente_telefono,
        direccion_entrega: params.pedidoCocina.direccion_entrega,
        observacion: params.pedidoCocina.observacion,
        items: itemsSnapshot,
        venta_id: ventaId,
        numero_control: numeroControl,
        fecha_iso: fechaIso,
      };
      const metadata = {
        source: "venta",
        venta_id: ventaId,
        numero_control: numeroControl,
        modalidad: params.pedidoCocina.modalidad,
      };
      const tituloModalidad =
        params.pedidoCocina.modalidad === "local" ? "Local"
        : params.pedidoCocina.modalidad === "delivery" ? "Delivery"
        : "Retiro";
      const detalle =
        params.pedidoCocina.modalidad === "local" && params.pedidoCocina.mesa
          ? ` · Mesa ${params.pedidoCocina.mesa}`
          : params.pedidoCocina.modalidad === "delivery" && params.pedidoCocina.cliente_nombre
          ? ` · ${params.pedidoCocina.cliente_nombre}`
          : "";
      const titulo = `Venta ${numeroControl} · ${tituloModalidad}${detalle}`.slice(0, 200);

      const insProy = await sb.from("proyectos").insert({
        empresa_id: params.empresaId,
        sucursal_id: params.sucursalId,
        cliente_id: params.clienteId,
        tipo_id: tipoId,
        estado_id: estadoId,
        titulo,
        prioridad: "normal",
        monto_vendido: params.totalDeclarado,
        fecha_ingreso: fechaIso,
        brief_data: briefData,
        metadata,
      });
      if (insProy.error) throw new Error(insProy.error.message);
    }

    // 9) Cuenta por cobrar (solo CRÉDITO con cliente). El saldo inicial = total de la venta;
    //    estado 'pendiente'. NO afecta stock ni movimientos: es cobranza. Un índice único
    //    sobre venta_id impide CxC duplicada si la venta se reintentara.
    let cuentaPorCobrarId: string | null = null;
    if (params.tipoVenta === "CREDITO" && params.clienteId) {
      // OJO: la fecha calendario tiene que ser la de Paraguay, no la del server
      // en UTC. Si usamos slice(0,10) sobre un ISO UTC despues de las 21:00 PY,
      // el dia salta al siguiente en UTC y el fecha_emision queda desalineado
      // con la firma SIFEN (rechazo 0362 [1004] "fecha adelantada").
      const fechaEmision = asuncionYmd(fechaIso);
      let fechaVencimiento: string | null = null;
      if (params.fechaVencimiento) {
        fechaVencimiento = params.fechaVencimiento;
      } else if (params.plazoDias && params.plazoDias > 0) {
        // Sumar dias sobre el YMD Paraguay (no sobre el ISO UTC).
        const [yy, mm, dd] = fechaEmision.split("-").map((x) => parseInt(x, 10));
        const base = new Date(Date.UTC(yy, mm - 1, dd));
        base.setUTCDate(base.getUTCDate() + params.plazoDias);
        const y = base.getUTCFullYear();
        const m = String(base.getUTCMonth() + 1).padStart(2, "0");
        const d = String(base.getUTCDate()).padStart(2, "0");
        fechaVencimiento = `${y}-${m}-${d}`;
      }
      const insCxc = await sb
        .from("cuentas_por_cobrar")
        .insert({
          empresa_id: params.empresaId,
          sucursal_id: params.sucursalId,
          cliente_id: params.clienteId,
          venta_id: ventaId,
          numero_venta: numeroControl,
          fecha_emision: fechaEmision,
          fecha_vencimiento: fechaVencimiento,
          moneda: params.moneda === "USD" ? "USD" : "PYG",
          total: calc.total,
          saldo: calc.total,
          estado: "pendiente",
        })
        .select("id")
        .single();
      if (insCxc.error) throw new Error(insCxc.error.message);
      cuentaPorCobrarId = String((insCxc.data as { id: string }).id);
    }

    // ── Puente Venta → Factura ERP (SIFEN legal) ───────────────────────────
    // Al mismo tiempo que la venta creamos una factura ERP con FAC-XXXXXX y las
    // líneas equivalentes, dejando `ventas.factura_id` linkeado. Después el
    // detalle /facturas/[id] usa el mismo FacturaElectronicaPanel para firmar,
    // enviar a SIFEN e imprimir KUDE legal.
    //
    // Best-effort: si algo del puente falla, la venta ya está creada y no la
    // rompemos — devolvemos facturaWarning para que la UI decida qué hacer.
    //
    // Opt-out: si `emitirFactura===false` (elección "solo ticket" del cajero),
    // se salta el bloque entero. La venta queda registrada sin factura ERP.
    let facturaId: string | null = null;
    let numeroFactura: string | null = null;
    let facturaWarning: string | null = null;
    const emitirFactura = params.emitirFactura !== false;
    if (emitirFactura) try {
      // 1) Snapshot de razón social / RUC — si hay cliente_id usamos su ficha
      //    (nombre_facturacion tiene prioridad sobre razón social/nombre_contacto);
      //    si no, dejamos vacío y el operador puede editar en el detalle.
      let razonSocial: string | null = null;
      let rucSnap: string | null = null;
      if (params.clienteId) {
        const cliQ = await sb
          .from("clientes")
          .select("empresa, nombre, nombre_contacto, nombre_facturacion, ruc")
          .eq("id", params.clienteId)
          .eq("empresa_id", params.empresaId)
          .maybeSingle();
        const c = cliQ.data as Record<string, string | null> | null;
        if (c) {
          const s = (v: string | null | undefined) =>
            typeof v === "string" && v.trim() ? v.trim() : null;
          razonSocial = s(c.nombre_facturacion) || s(c.empresa) || s(c.nombre_contacto) || s(c.nombre);
          rucSnap = s(c.ruc);
        }
      }

      // 2) Próximo FAC-XXXXXX. Best-effort race — el índice único
      //    (empresa_id, numero_factura) protege contra duplicados.
      const maxQ = await sb
        .from("facturas")
        .select("numero_factura")
        .eq("empresa_id", params.empresaId)
        .eq("sucursal_id", params.sucursalId)
        .like("numero_factura", "FAC-%")
        .order("numero_factura", { ascending: false })
        .limit(1);
      let nextNum = 1;
      const prevRaw =
        Array.isArray(maxQ.data) && maxQ.data.length > 0
          ? (maxQ.data[0] as { numero_factura?: string }).numero_factura
          : null;
      if (typeof prevRaw === "string") {
        const m = /^FAC-(\d+)$/.exec(prevRaw.trim());
        if (m) nextNum = parseInt(m[1], 10) + 1;
      }
      numeroFactura = `FAC-${String(nextNum).padStart(6, "0")}`;

      // 3) Insert facturas — cliente_id es NULL si la venta no tiene cliente
      //    real (el schema ya lo permite tras la migración del puente).
      const facPayload: Record<string, unknown> = {
        empresa_id: params.empresaId,
        sucursal_id: params.sucursalId,
        cliente_id: params.clienteId ?? null,
        numero_factura: numeroFactura,
        // Fecha calendario en zona Paraguay (misma razon que fechaEmision arriba).
        fecha: asuncionYmd(fechaIso),
        fecha_vencimiento: asuncionYmd(fechaIso),
        monto: calc.total,
        saldo: params.tipoVenta === "CREDITO" ? calc.total : 0,
        estado: params.tipoVenta === "CREDITO" ? "Pendiente" : "Pagado",
        tipo: params.tipoVenta === "CREDITO" ? "credito" : "contado",
        moneda: params.moneda === "USD" ? "USD" : "GS",
        cliente_razon_social: razonSocial,
        cliente_ruc: rucSnap,
        observaciones: observacionesFinal,
        origen_venta_id: ventaId,
      };
      const insFac = await sb.from("facturas").insert(facPayload).select("id").single();
      if (insFac.error) throw new Error(insFac.error.message);
      facturaId = String((insFac.data as { id: string }).id);

      // 4) factura_items — una fila por línea con tipo_iva (para desglose SIFEN).
      const itemsFacRows = items.map((line) => ({
        empresa_id: params.empresaId,
        factura_id: facturaId,
        descripcion: line.producto_nombre,
        cantidad: line.cantidad,
        precio_unitario: line.precio_venta,
        subtotal: line.subtotal,
        iva: line.monto_iva,
        tipo_iva: line.tipo_iva,
        total: line.total_linea,
      }));
      const insFacItems = await sb.from("factura_items").insert(itemsFacRows);
      if (insFacItems.error) throw new Error(insFacItems.error.message);

      // 5) Link venta → factura.
      const linkUpd = await sb
        .from("ventas")
        .update({ factura_id: facturaId })
        .eq("id", ventaId)
        .eq("empresa_id", params.empresaId);
      if (linkUpd.error) throw new Error(linkUpd.error.message);
    } catch (bridgeErr) {
      const msg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
      facturaWarning = `Venta creada pero no se pudo generar la factura ERP: ${msg}`;
      // Rollback best-effort de la factura (los items caen en cascada por FK).
      if (facturaId) {
        try {
          await sb.from("facturas").delete().eq("id", facturaId).eq("empresa_id", params.empresaId);
        } catch {}
        facturaId = null;
        numeroFactura = null;
      }
    }

    return {
      ventaId,
      numeroControl,
      fechaIso,
      notaRemisionNumero,
      cuentaPorCobrarId,
      facturaId,
      numeroFactura,
      facturaWarning,
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}
