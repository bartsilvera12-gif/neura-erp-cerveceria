"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Undo2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Devolucion } from "@/lib/ventas/devoluciones-listado";

/**
 * Todas las devoluciones del período.
 *
 * Qué responde esta pantalla: cuánta plata volvió al cliente, qué productos
 * volvieron al stock y por qué. Sin esto, una devolución sólo se podía ver
 * buscando el movimiento suelto en el kardex, donde no se ve ni el monto ni el
 * motivo.
 */

const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;

const hoyPy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
const hace30 = () => {
  const d = new Date(hoyPy() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
};

function fechaHora(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return iso;
  return t.toLocaleString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Asuncion",
  });
}

type Totales = { cantidad: number; unidades: number; monto: number };

export default function DevolucionesPage() {
  const [desde, setDesde] = useState(hace30());
  const [hasta, setHasta] = useState(hoyPy());
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/ventas/devoluciones?desde=${desde}&hasta=${hasta}`,
        { cache: "no-store" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudieron cargar las devoluciones (${res.status}).`);
        return;
      }
      setError(null);
      setDevoluciones((j.data?.devoluciones ?? []) as Devolucion[]);
      setTotales((j.data?.totales ?? null) as Totales | null);
    } catch {
      setError("Error de red.");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const inputCls =
    "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-[#4FAEB2]";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/ventas" className="text-xs text-slate-400 hover:text-slate-600">
            ← Caja
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <Undo2 className="h-5 w-5 text-amber-600" aria-hidden /> Devoluciones
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Lo que los clientes trajeron de vuelta: el stock volvió y la plata se devolvió. Las
            ventas siguen existiendo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Desde
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Hasta
            <input type="date" value={hasta} min={desde} max={hoyPy()} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      {totales && totales.cantidad > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Devoluciones</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{totales.cantidad}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unidades devueltas</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{totales.unidades}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Plata devuelta</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-900">{fmtGs(totales.monto)}</p>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : devoluciones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-16 text-center">
          <p className="text-sm text-slate-600">No hubo devoluciones entre el {desde} y el {hasta}.</p>
          <p className="mt-1 text-xs text-slate-400">
            Una devolución se registra desde Caja, con el botón Devolver de cada venta.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold">Venta</th>
                  <th className="px-4 py-3 text-left font-semibold">Qué volvió</th>
                  <th className="px-3 py-3 text-right font-semibold">Unid.</th>
                  <th className="px-3 py-3 text-right font-semibold">Devuelto</th>
                  <th className="px-4 py-3 text-left font-semibold">Quién</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devoluciones.map((d) => (
                  <tr key={d.id} className="align-top hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                      {fechaHora(d.fecha)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {d.venta_id ? (
                        <a
                          href={`/api/ventas/${d.venta_id}/ticket`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-[#2F6F72] hover:underline"
                        >
                          {d.numero_control ?? "Ver ticket"}
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5">
                        {d.items.map((it, i) => (
                          <li key={`${d.id}-${i}`} className="text-slate-700">
                            <strong className="tabular-nums">{it.cantidad}×</strong> {it.producto_nombre}
                            <span className="ml-1 text-xs text-slate-400">{fmtGs(it.monto)}</span>
                          </li>
                        ))}
                      </ul>
                      {d.motivo && (
                        <p className="mt-1 text-xs italic text-amber-700">{d.motivo}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{d.unidades}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-amber-800">
                      {fmtGs(d.monto)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.usuario_nombre ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
