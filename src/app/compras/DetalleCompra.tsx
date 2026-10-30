"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  errorNumeroComprobante,
  formatearNumeroComprobante,
} from "@/lib/validacion/documentos";
import type { Compra, MetodoPago } from "@/lib/compras/types";

/**
 * Detalle de una compra, desplegable desde la lista.
 *
 * ANTES NO HABIA FORMA DE VER UNA COMPRA
 * La fila sólo se abría cuando tenía más de un producto, así que una compra de
 * un solo ítem — la mayoría — no se podía abrir: el timbrado, la condición de
 * pago, el motivo de anulación y el costo unitario no se veían en ningún lado.
 *
 * QUE SE PUEDE CORREGIR DESDE ACA
 * Sólo los datos del comprobante: número de factura, fecha de la factura y
 * método de pago. Son los que se cargan mal o llegan después. Cantidades y
 * costos no, porque la compra ya sumó stock y movió el costo del producto: eso
 * se arregla anulando (que lo reintegra en reverso) y volviendo a cargar.
 */

const fmtGs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const etiquetaIva: Record<string, string> = { exenta: "Exenta", "5": "5%", "10": "10%" };

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</dt>
      <dd className="mt-0.5 text-xs text-slate-700">{valor}</dd>
    </div>
  );
}

export default function DetalleCompra({
  numeroControl,
  items,
  numeroFactura,
  fechaFactura,
  metodoPago,
  tipoPago,
  plazoDias,
  fechaRegistro,
  anulada,
  anulacionMotivo,
  tieneComprobante,
  onGuardado,
}: {
  numeroControl: string;
  items: Compra[];
  numeroFactura: string | null;
  fechaFactura: string | null;
  metodoPago: MetodoPago | null;
  tipoPago: string;
  plazoDias?: number;
  fechaRegistro: string;
  anulada: boolean;
  anulacionMotivo?: string | null;
  tieneComprobante: boolean;
  /** Para que la lista se refresque con los datos nuevos. */
  onGuardado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [fNumero, setFNumero] = useState(numeroFactura ?? "");
  const [fFecha, setFFecha] = useState(fechaFactura ?? "");
  const [fMetodo, setFMetodo] = useState<string>(metodoPago ?? "");

  const subtotal = items.reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
  const iva = items.reduce((a, i) => a + (Number(i.monto_iva) || 0), 0);
  const total = items.reduce((a, i) => a + (Number(i.total) || 0), 0);
  const primero = items[0];

  async function guardar() {
    const errNumero = errorNumeroComprobante(fNumero);
    if (errNumero) return setError(errNumero);
    setError(null);
    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/compras/${encodeURIComponent(numeroControl)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numero_factura_proveedor: fNumero.trim(),
            fecha_factura: fFecha,
            metodo_pago: fMetodo,
          }),
        }
      );
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? `No se pudo guardar (${res.status}).`);
        return;
      }
      setOk(true);
      setEditando(false);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#4FAEB2]";

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Dato etiqueta="N° de control" valor={<span className="font-mono">{numeroControl}</span>} />
          <Dato
            etiqueta="N° de factura"
            valor={numeroFactura || <span className="italic text-slate-400">Sin cargar</span>}
          />
          <Dato etiqueta="Timbrado" valor={primero?.nro_timbrado || "—"} />
          <Dato
            etiqueta="Condición"
            valor={
              tipoPago === "credito" ? `Crédito ${plazoDias ?? ""} días`.trim() : "Contado"
            }
          />
          <Dato
            etiqueta="Método de pago"
            valor={metodoPago ? metodoPago[0].toUpperCase() + metodoPago.slice(1) : "—"}
          />
          <Dato etiqueta="Fecha de registro" valor={fechaCorta(fechaRegistro)} />
          <Dato etiqueta="Fecha de factura" valor={fechaCorta(fechaFactura)} />
          <Dato
            etiqueta="Moneda"
            valor={
              primero?.moneda === "USD"
                ? `USD (cambio ${Number(primero.tipo_cambio).toLocaleString("es-PY")})`
                : "Guaraníes"
            }
          />
        </dl>
        {tieneComprobante && (
          <a
            href={`/api/compras/comprobante?numero_control=${encodeURIComponent(numeroControl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#4FAEB2] hover:bg-slate-50"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden />
            Ver comprobante
          </a>
        )}
      </div>

      {anulada && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          Compra anulada. El stock se reintegró en reverso.
          {anulacionMotivo ? ` Motivo: ${anulacionMotivo}` : ""}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-semibold">Producto</th>
              <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
              <th className="px-3 py-2 text-right font-semibold">Costo unit.</th>
              <th className="px-3 py-2 text-center font-semibold">IVA</th>
              <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 text-slate-700">{it.producto_nombre}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{it.cantidad}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {fmtGs(it.costo_unitario)}
                </td>
                <td className="px-3 py-2 text-center text-slate-500">
                  {etiquetaIva[it.iva_tipo] ?? it.iva_tipo}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {fmtGs(it.subtotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                  {fmtGs(it.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 text-slate-600">
              <td className="px-3 py-2" colSpan={4} />
              <td className="px-3 py-2 text-right text-[10px] uppercase tracking-wide">Subtotal</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtGs(subtotal)}</td>
            </tr>
            <tr className="text-slate-600">
              <td className="px-3 py-1" colSpan={4} />
              <td className="px-3 py-1 text-right text-[10px] uppercase tracking-wide">IVA</td>
              <td className="px-3 py-1 text-right tabular-nums">{fmtGs(iva)}</td>
            </tr>
            <tr className="text-slate-900">
              <td className="px-3 py-2" colSpan={4} />
              <td className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide">
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-sm font-bold">{fmtGs(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!anulada && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          {!editando ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Se pueden corregir los datos del comprobante. Para cambiar cantidades o costos hay
                que anular la compra y volver a cargarla: así el stock se reintegra.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditando(true);
                  setOk(false);
                }}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Editar datos de factura
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    N° de factura
                  </label>
                  <input
                    type="text"
                    value={fNumero}
                    onChange={(e) => setFNumero(formatearNumeroComprobante(e.target.value))}
                    placeholder="001-001-0000001"
                    inputMode="numeric"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Fecha de factura
                  </label>
                  <input
                    type="date"
                    value={fFecha}
                    onChange={(e) => setFFecha(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Método de pago
                  </label>
                  <select
                    value={fMetodo}
                    onChange={(e) => setFMetodo(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Sin especificar</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                  </select>
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando}
                  className="rounded-lg bg-[#4FAEB2] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditando(false);
                    setError(null);
                    setFNumero(numeroFactura ?? "");
                    setFFecha(fechaFactura ?? "");
                    setFMetodo(metodoPago ?? "");
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {ok && !editando && (
            <p className="mt-2 text-xs font-medium text-emerald-700">Datos guardados.</p>
          )}
        </div>
      )}
    </div>
  );
}
