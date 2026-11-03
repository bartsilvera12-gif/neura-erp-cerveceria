"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Undo2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Devolver parte de una venta.
 *
 * El cliente se llevó cuatro chops y trae dos. La venta no se anula —pasó, se
 * cobró, está en el arqueo—: vuelven dos chops al stock y se le devuelve lo que
 * pagó por esos dos.
 *
 * De cada línea sólo se ofrece lo que QUEDA por devolver: si ya trajo uno la
 * semana pasada, hoy no puede traer cuatro.
 */

type Linea = {
  producto_id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  devuelto: number;
  devolvible: number;
};

type Props = {
  ventaId: string;
  numeroControl: string;
  onClose: () => void;
  onDevuelta: () => void;
};

const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;

export default function DevolucionVentaModal({ ventaId, numeroControl, onClose, onDevuelta }: Props) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      try {
        const res = await fetchWithSupabaseSession(`/api/ventas/${ventaId}/devolucion`, {
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok || !j?.success) {
          setError(j?.error ?? "No se pudo cargar la venta.");
          return;
        }
        setLineas((j.data?.lineas ?? []) as Linea[]);
      } catch {
        if (vivo) setError("Error de red.");
      } finally {
        if (vivo) setCargando(false);
      }
    };
    pedir();
    return () => {
      vivo = false;
    };
  }, [ventaId]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose, guardando]);

  function cambiar(productoId: string, valor: string, tope: number) {
    const n = Number(valor);
    if (valor !== "" && (!Number.isFinite(n) || n < 0)) return;
    const limitado = valor === "" ? "" : String(Math.min(n, tope));
    setCantidades((prev) => ({ ...prev, [productoId]: limitado }));
  }

  const seleccion = lineas
    .map((l) => ({ linea: l, cantidad: Number(cantidades[l.producto_id] ?? "") || 0 }))
    .filter((x) => x.cantidad > 0);
  const monto = seleccion.reduce((a, x) => a + x.cantidad * x.linea.precio_venta, 0);
  const hayAlgoQueDevolver = lineas.some((l) => l.devolvible > 0);

  /** Llena cada línea con todo lo que queda por devolver. */
  function devolverTodo() {
    const todo: Record<string, string> = {};
    for (const l of lineas) if (l.devolvible > 0) todo[l.producto_id] = String(l.devolvible);
    setCantidades(todo);
    setError(null);
  }

  async function confirmar() {
    if (guardando) return;
    /**
     * Antes el botón se desactivaba cuando no había nada elegido. Desde el otro
     * lado de la pantalla eso se ve igual que un botón roto: se aprieta, no
     * pasa nada, y no hay forma de saber que falta poner una cantidad.
     */
    if (seleccion.length === 0) {
      setError("Poné cuántos vuelven: escribí la cantidad en al menos un producto, o usá “Devolver todo”.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/ventas/${ventaId}/devolucion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: seleccion.map((x) => ({ producto_id: x.linea.producto_id, cantidad: x.cantidad })),
          motivo: motivo.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? "No se pudo registrar la devolución.");
        return;
      }
      // Si no había caja abierta, la plata no salió de ningún lado: hay que
      // decirlo, o al cierre va a faltar efectivo sin explicación.
      if (j.data?.caja === "sin_caja") {
        setAviso(
          `Devolución registrada por ${fmtGs(j.data?.monto ?? monto)}. No hay caja abierta, ` +
            "así que la plata no salió de la caja: cargá el egreso cuando la abras."
        );
        return;
      }
      const cuantos = (j.data?.devueltos ?? []).reduce(
        (a: number, d: { cantidad?: number }) => a + (Number(d.cantidad) || 0),
        0
      );
      setAviso(
        `Listo: volvieron ${cuantos} ${cuantos === 1 ? "unidad" : "unidades"} al stock por ` +
          `${fmtGs(j.data?.monto ?? monto)}.` +
          (j.data?.caja === "registrada" ? " La plata salió de la caja como egreso." : "")
      );
      return;
    } catch {
      setError("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
              <Undo2 className="h-5 w-5 text-amber-600" aria-hidden />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">Devolver productos</h3>
              <p className="text-xs text-slate-500">Venta {numeroControl}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={guardando}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {cargando ? (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando la venta…
            </p>
          ) : aviso ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              {aviso}
            </p>
          ) : !hayAlgoQueDevolver ? (
            <p className="py-6 text-sm text-slate-500">
              Esta venta ya se devolvió entera: no queda nada por traer de vuelta.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Poné cuántos vuelven de cada producto. El stock vuelve y se devuelve lo que el
                  cliente pagó por eso. La venta no se anula.
                </p>
                <button
                  type="button"
                  onClick={devolverTodo}
                  className="shrink-0 rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                >
                  Devolver todo
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {lineas.map((l) => (
                  <li key={l.producto_id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{l.producto_nombre}</p>
                      <p className="text-xs text-slate-500">
                        {l.cantidad} × {fmtGs(l.precio_venta)}
                        {l.devuelto > 0 && ` · ya devueltos ${l.devuelto}`}
                      </p>
                    </div>
                    {l.devolvible > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={l.devolvible}
                          value={cantidades[l.producto_id] ?? ""}
                          onChange={(e) => cambiar(l.producto_id, e.target.value, l.devolvible)}
                          placeholder="0"
                          className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[#4FAEB2]"
                        />
                        <button
                          type="button"
                          onClick={() => cambiar(l.producto_id, String(l.devolvible), l.devolvible)}
                          title="Devolver todo lo que queda de este producto"
                          className="w-14 text-left text-xs text-slate-400 hover:text-amber-700 hover:underline"
                        >
                          de {l.devolvible}
                        </button>
                      </div>
                    ) : (
                      <span className="w-[8.5rem] text-right text-xs text-slate-400">
                        Ya devuelto
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <label className="mt-4 block text-xs font-medium text-slate-600">
                Motivo (queda en el kardex)
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: la cerveza salió con gusto raro"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
                />
              </label>
            </>
          )}

          {error && (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <span className="text-sm text-slate-600">
            A devolver: <strong className="tabular-nums text-slate-900">{fmtGs(monto)}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={aviso ? onDevuelta : onClose}
              disabled={guardando}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {aviso ? "Listo" : "Volver"}
            </button>
            {!aviso && (
              <button
                type="button"
                onClick={confirmar}
                disabled={guardando}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {guardando ? "Devolviendo…" : "Devolver"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
