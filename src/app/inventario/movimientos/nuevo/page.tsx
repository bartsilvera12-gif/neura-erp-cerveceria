"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import { getProductos, saveMovimiento } from "@/lib/inventario/storage";
import type { Producto, TipoMovimiento, OrigenMovimiento } from "@/lib/inventario/types";
import SearchableSelect from "@/components/ui/SearchableSelect";

export default function NuevoMovimientoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);

  const [form, setForm] = useState({
    producto_id: "",
    tipo: "ENTRADA" as TipoMovimiento,
    cantidad: "",
    costo_unitario: "",
    origen: "compra" as OrigenMovimiento,
    motivo: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Guard contra el doble registro. El botón no daba ninguna señal de estar
   * trabajando, y sobre una base remota el guardado tarda lo suficiente para
   * que el usuario vuelva a apretar: el movimiento se registraba dos veces y
   * el stock sumaba el doble. El ref corta el segundo envío en el mismo tick,
   * antes de que `guardando` llegue a re-renderizar el botón.
   */
  const enviandoRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getProductos().then((data) => {
      if (!cancelled) setProductos(data);
    });
    return () => { cancelled = true; };
  }, []);

  function handleProductoChange(id: string) {
    const producto = productos.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      producto_id: id,
      costo_unitario: producto ? String(producto.costo_promedio) : "",
    }));
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleTipoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tipo = e.target.value as TipoMovimiento;
    const origenSugerido: OrigenMovimiento =
      tipo === "ENTRADA" ? "compra" : tipo === "SALIDA" ? "venta" : "ajuste_manual";
    setForm((prev) => ({ ...prev, tipo, origen: origenSugerido }));
  }

  /** Un ajuste manual no tiene documento que lo explique: pide motivo. */
  const exigeMotivo = form.tipo === "AJUSTE" || form.origen === "ajuste_manual";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviandoRef.current) return;

    const productoSeleccionado = productos.find((p) => p.id === form.producto_id);
    if (!productoSeleccionado) return setError("Elegí un producto.");

    const cantidadNum =
      form.tipo === "AJUSTE"
        ? parseFloat(form.cantidad)
        : Math.abs(parseFloat(form.cantidad));
    if (!Number.isFinite(cantidadNum) || cantidadNum === 0) {
      return setError("Indicá una cantidad distinta de 0.");
    }
    const motivo = form.motivo.trim();
    if (exigeMotivo && motivo.length < 3) {
      return setError("Escribí el motivo del ajuste: es lo único que explica por qué cambió el stock.");
    }
    // El stock se valida igual en el guardado, pero avisar acá evita que el
    // operador descubra el problema recién después de apretar.
    if (
      cantidadNum < 0 || form.tipo === "SALIDA"
    ) {
      const salida = form.tipo === "SALIDA" ? cantidadNum : Math.abs(cantidadNum);
      if (productoSeleccionado.controla_stock !== false && salida > productoSeleccionado.stock_actual) {
        return setError(
          `No hay stock suficiente: hay ${productoSeleccionado.stock_actual} y querés sacar ${salida}.`
        );
      }
    }

    enviandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const guardado = await saveMovimiento({
        producto_id: productoSeleccionado.id,
        producto_nombre: productoSeleccionado.nombre,
        producto_sku: productoSeleccionado.sku,
        tipo: form.tipo,
        cantidad: cantidadNum,
        costo_unitario: parseFloat(form.costo_unitario) || 0,
        origen: form.origen,
        referencia: motivo || undefined,
        fecha: new Date().toISOString(),
      });
      if (!guardado) {
        throw new Error("No se pudo registrar el movimiento. Volvé a intentar.");
      }
      /**
       * En el camino feliz el guard NO se libera: la navegación tarda y, si se
       * libera acá, el usuario alcanza a apretar otra vez y queda un segundo
       * movimiento registrado.
       */
      router.push("/inventario/movimientos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento.");
      enviandoRef.current = false;
      setGuardando(false);
    }
  }

  const productoSeleccionado = productos.find((p) => p.id === form.producto_id);

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-gray-500 transition-colors text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-2";

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo movimiento</h1>
        <p className="text-gray-600">Registra una entrada, salida o ajuste de stock</p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-2xl">
        <form className="space-y-6" onSubmit={handleSubmit}>

          {/* Producto */}
          <div>
            <label className={labelClass}>Producto</label>
            {/* Buscable y no un <select>: con el catalogo entero adentro
                habia que recorrer la lista a ojo. */}
            <SearchableSelect
              value={form.producto_id || null}
              onChange={(id) => handleProductoChange(id ?? "")}
              options={productos.map((p) => ({
                id: String(p.id),
                label: p.nombre,
                hint: `${p.sku} · stock ${p.stock_actual}`,
              }))}
              placeholder="Buscá por nombre o SKU…"
              emptyText="Sin productos que coincidan"
            />
          </div>

          {/* Tipo + Origen */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>Tipo de movimiento</label>
              <select
                name="tipo"
                value={form.tipo}
                onChange={handleTipoChange}
                className={inputClass}
              >
                <option value="ENTRADA">ENTRADA — aumenta stock</option>
                <option value="SALIDA">SALIDA — disminuye stock</option>
                <option value="AJUSTE">AJUSTE — corrección manual</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Origen</label>
              <select
                name="origen"
                value={form.origen}
                onChange={handleChange}
                className={inputClass}
              >
                <option value="compra">Compra</option>
                <option value="venta">Venta</option>
                <option value="ajuste_manual">Ajuste manual</option>
              </select>
            </div>
          </div>

          {/* Cantidad + Costo unitario */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                Cantidad
                {form.tipo === "AJUSTE" && (
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    (negativo para disminuir)
                  </span>
                )}
              </label>
              <input
                type="number"
                name="cantidad"
                value={form.cantidad}
                onChange={handleChange}
                placeholder={form.tipo === "AJUSTE" ? "Ej: -3 o +5" : "Ej: 10"}
                className={inputClass}
                step="1"
                required
              />
            </div>

            <div>
              <label className={labelClass}>Costo unitario (Gs.)</label>
              <MontoInput
                value={form.costo_unitario}
                onChange={(n) => setForm((prev) => ({ ...prev, costo_unitario: String(n) }))}
                placeholder="Ej: 35000"
                className={inputClass}
                decimals={false}
                required
              />
            </div>
          </div>

          {/* Motivo. Obligatorio en un ajuste manual: es el unico movimiento
              que no tiene un documento detras (una compra, una venta) que
              explique por que cambio el stock. Sin motivo, seis meses despues
              nadie sabe si fue un conteo, una rotura o un error de carga. */}
          {exigeMotivo && (
            <div>
              <label className={labelClass}>
                Motivo <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="motivo"
                value={form.motivo}
                onChange={handleChange}
                placeholder="Ej: conteo fisico de octubre, rotura, vencimiento"
                className={inputClass}
                maxLength={200}
                autoComplete="off"
              />
            </div>
          )}

          {/* Nota de fecha automática */}
          <p className="text-xs text-gray-400">
            La fecha y hora del movimiento se registrarán automáticamente al guardar.
          </p>

          {/* Vista previa del impacto en stock */}
          {productoSeleccionado && form.cantidad !== "" && (
            <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 text-sm space-y-1">
              <p className="font-medium text-gray-700 mb-2">Vista previa del impacto</p>
              <div className="flex justify-between text-gray-600">
                <span>Stock actual</span>
                <span className="font-semibold tabular-nums">
                  {productoSeleccionado.stock_actual} uds.
                </span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Movimiento ({form.tipo})</span>
                <span className={`font-semibold tabular-nums ${
                  form.tipo === "ENTRADA"
                    ? "text-green-600"
                    : form.tipo === "SALIDA"
                    ? "text-red-600"
                    : "text-yellow-600"
                }`}>
                  {form.tipo === "ENTRADA" ? "+" : form.tipo === "SALIDA" ? "−" : ""}
                  {form.tipo !== "AJUSTE"
                    ? Math.abs(parseFloat(form.cantidad) || 0)
                    : parseFloat(form.cantidad) || 0}{" "}
                  uds.
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold text-gray-800">
                <span>Stock resultante</span>
                <span className="tabular-nums">
                  {Math.max(
                    0,
                    form.tipo === "ENTRADA"
                      ? productoSeleccionado.stock_actual + Math.abs(parseFloat(form.cantidad) || 0)
                      : form.tipo === "SALIDA"
                      ? productoSeleccionado.stock_actual - Math.abs(parseFloat(form.cantidad) || 0)
                      : productoSeleccionado.stock_actual + (parseFloat(form.cantidad) || 0)
                  )}{" "}
                  uds.
                </span>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={guardando}
              className="bg-gray-900 text-white px-5 py-3 rounded-lg text-sm hover:bg-gray-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "Guardar movimiento"}
            </button>
            <button
              type="button"
              disabled={guardando}
              onClick={() => router.push("/inventario/movimientos")}
              className="border border-gray-300 px-5 py-3 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}
