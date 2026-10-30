"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Printer, Search, Trash2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useDialogos } from "@/components/ui/Dialogos";

/**
 * La cuenta de una mesa: lo pedido por ronda, agregar una ronda nueva,
 * imprimir su comanda y cerrar para cobrar en Caja.
 *
 * Cerrar NO cobra: manda el pedido a Caja y lleva al cajero a la pantalla de
 * venta con todo precargado. El stock baja ahí, al confirmar la venta.
 */

type ItemMesa = {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  precio_venta: number;
  total_linea: number;
  ronda: number;
  observacion?: string | null;
};
type Mesa = {
  id: string;
  mesa: string;
  rondas: number[];
  total: number;
  items: ItemMesa[];
  facturacion_estado: string | null;
};
type Hit = { id: string; nombre: string; sku?: string | null; precio_venta?: number };

const fmtGs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

export default function MesaDetallePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { avisar, confirmar } = useDialogos();

  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Ronda que se está armando, todavía no mandada.
  const [pendientes, setPendientes] = useState<Array<{ producto_id: string; nombre: string; cantidad: number }>>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [buscando, setBuscando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession(`/api/mesas/${id}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudo cargar la mesa (${res.status}).`);
        return;
      }
      setError(null);
      setMesa(j.data.mesa as Mesa);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  // Buscador de productos, con el mismo endpoint que usa la caja.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(q)}&limit=20`,
          { cache: "no-store" }
        );
        const j = await res.json().catch(() => ({}));
        setHits(res.ok && j?.success ? ((j.data?.items ?? []) as Hit[]) : []);
      } catch {
        setHits([]);
      } finally {
        setBuscando(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  function agregarPendiente(h: Hit) {
    setPendientes((prev) => {
      const i = prev.findIndex((p) => p.producto_id === h.id);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + 1 };
        return copia;
      }
      return [...prev, { producto_id: h.id, nombre: h.nombre, cantidad: 1 }];
    });
    setQuery("");
    setHits([]);
  }

  async function mandarRonda() {
    if (pendientes.length === 0) return;
    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/mesas/${id}/rondas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: pendientes.map((p) => ({ producto_id: p.producto_id, cantidad: p.cantidad })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo agregar la ronda.", tono: "peligro" });
        return;
      }
      setPendientes([]);
      // La comanda se abre sola: es el motivo de mandar la ronda.
      try {
        window.open(`/api/mesas/${id}/comanda?ronda=${j.data.ronda}&auto=1`, "_blank", "noopener");
      } catch { /* bloqueador de pop-ups: queda el botón de imprimir en la ronda */ }
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(indice: number) {
    const res = await fetchWithSupabaseSession(`/api/mesas/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "quitar_item", indice }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.success) {
      await avisar({ mensaje: j?.error ?? "No se pudo quitar.", tono: "peligro" });
      return;
    }
    await cargar();
  }

  async function cerrar() {
    if (!mesa) return;
    const seguir = await confirmar({
      titulo: `Cerrar la mesa ${mesa.mesa}`,
      mensaje: `Total ${fmtGs(mesa.total)}. Va a Caja para cobrarse; después no se le puede agregar nada más.`,
      confirmar: "Cerrar y cobrar",
    });
    if (!seguir) return;
    setGuardando(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/mesas/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cerrar" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo cerrar la mesa.", tono: "peligro" });
        return;
      }
      router.push(`/ventas/nueva?pedido_id=${encodeURIComponent(id)}`);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (!mesa) {
    return (
      <div className="space-y-3 p-6">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "Mesa no encontrada."}
        </p>
        <Link href="/ventas/mesas" className="text-sm text-[#4FAEB2] hover:underline">← Volver al salón</Link>
      </div>
    );
  }

  const enCaja = mesa.facturacion_estado === "pendiente_caja";
  const ultimaRonda = mesa.rondas.length > 0 ? mesa.rondas[mesa.rondas.length - 1] : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/ventas/mesas" className="text-xs text-slate-400 hover:text-slate-600">
            ← Salón
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Mesa {mesa.mesa}</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {mesa.rondas.length} {mesa.rondas.length === 1 ? "ronda" : "rondas"} ·{" "}
            <span className="font-semibold text-slate-700">{fmtGs(mesa.total)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={cerrar}
          disabled={guardando || mesa.items.length === 0}
          className="shrink-0 rounded-lg bg-[#4FAEB2] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
        >
          {enCaja ? "Ir a cobrar" : "Cerrar y cobrar"}
        </button>
      </div>

      {enCaja && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          La mesa ya está cerrada y esperando cobro en Caja. No se le puede agregar nada más.
        </p>
      )}

      {/* Lo ya pedido, agrupado por ronda */}
      <div className="space-y-3">
        {mesa.rondas.map((nro) => (
          <div key={nro} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Ronda {nro}
              </span>
              <a
                href={`/api/mesas/${id}/comanda?ronda=${nro}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4FAEB2] hover:underline"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden /> Comanda
              </a>
            </div>
            <ul className="divide-y divide-slate-100">
              {mesa.items.map((it, i) =>
                it.ronda !== nro ? null : (
                  <li key={`${nro}-${i}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="text-slate-700">
                      <strong className="tabular-nums">{it.cantidad}×</strong> {it.producto_nombre}
                      {it.observacion && (
                        <span className="block text-[11px] italic text-slate-500">{it.observacion}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-slate-600">{fmtGs(it.total_linea)}</span>
                      {!enCaja && nro === ultimaRonda && (
                        <button
                          type="button"
                          onClick={() => quitar(i)}
                          title="Quitar de la cuenta"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
        {mesa.items.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            La mesa está vacía. Agregá la primera ronda abajo.
          </p>
        )}
      </div>

      {/* Ronda nueva */}
      {!enCaja && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Agregar ronda
          </h2>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto por nombre o SKU…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
            />
            {query.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {buscando ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Buscando…</p>
                ) : hits.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Sin resultados.</p>
                ) : (
                  hits.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => agregarPendiente(h)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="text-slate-700">{h.nombre}</span>
                      {h.precio_venta != null && (
                        <span className="tabular-nums text-xs text-slate-500">{fmtGs(h.precio_venta)}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {pendientes.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {pendientes.map((p, i) => (
                <li key={p.producto_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-slate-700">{p.nombre}</span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPendientes((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))
                        )
                      }
                      className="h-6 w-6 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{p.cantidad}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendientes((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + 1 } : x))
                        )
                      }
                      className="h-6 w-6 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendientes((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={mandarRonda}
            disabled={pendientes.length === 0 || guardando}
            className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-40 sm:w-auto"
          >
            {guardando ? "Mandando…" : "Mandar a la cocina e imprimir comanda"}
          </button>
        </div>
      )}
    </div>
  );
}
