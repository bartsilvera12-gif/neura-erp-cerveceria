"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChefHat, Clock, Loader2, Printer, Receipt, RotateCcw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  ESTADO_LABEL,
  minutosDesde,
  type Comanda,
  type EstadoComanda,
} from "@/lib/comandas/comandas-domain";

/**
 * La pantalla de la barra y la cocina.
 *
 * Está pensada para una tablet colgada: letra grande, un botón por comanda y
 * nada que leer. Se refresca sola cada 15 segundos, porque nadie va a apretar
 * "actualizar" con las manos ocupadas.
 *
 * Una comanda es una RONDA: lo que entró junto se prepara junto. Cuando la
 * barra la marca lista, se va al final y queda en gris, no desaparece: si el
 * mozo pregunta "¿salió lo de la 7?", la respuesta tiene que seguir en
 * pantalla.
 */

const REFRESCO_MS = 15000;

/** A partir de acá la comanda está esperando demasiado y se marca en rojo. */
const MINUTOS_ALERTA = 15;

type Filtro = "activas" | "todas";

export default function ComandasPage() {
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("activas");
  const [tocando, setTocando] = useState<string | null>(null);
  /** Se recalcula solo para que los minutos corran sin pedir datos de nuevo. */
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/comandas", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudieron cargar las comandas (${res.status}).`);
        return;
      }
      setError(null);
      setComandas((j.data?.comandas ?? []) as Comanda[]);
    } catch {
      setError("Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    const reloj = setInterval(() => setAhora(Date.now()), 30000);
    return () => {
      clearInterval(t);
      clearInterval(reloj);
    };
  }, [cargar]);

  async function marcar(c: Comanda, estado: EstadoComanda) {
    setTocando(c.id);
    // Optimista: en la cocina el botón tiene que responder al toque, no dentro
    // de 300 ms. Si el servidor rechaza, el próximo refresco lo corrige.
    setComandas((prev) => prev.map((x) => (x.id === c.id ? { ...x, estado } : x)));
    try {
      const res = await fetchWithSupabaseSession("/api/comandas/estado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: c.pedido_id, ronda: c.ronda, estado }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) setError(j?.error ?? "No se pudo marcar la comanda.");
      await cargar();
    } catch {
      setError("Error de red.");
      await cargar();
    } finally {
      setTocando(null);
    }
  }

  const visibles = useMemo(
    () => (filtro === "activas" ? comandas.filter((c) => c.estado !== "listo") : comandas),
    [comandas, filtro]
  );
  const pendientes = comandas.filter((c) => c.estado === "pendiente").length;
  const preparando = comandas.filter((c) => c.estado === "preparando").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Barra y cocina
            </p>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <ChefHat className="h-5 w-5 text-[#4FAEB2]" aria-hidden /> Comandas
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {pendientes} sin empezar · {preparando} en preparación · se actualiza sola
          </p>
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ["activas", "Por preparar"],
              ["todas", "Todas"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFiltro(k)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                filtro === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-16 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" aria-hidden />
          <p className="mt-2 text-sm text-slate-600">No hay nada esperando.</p>
          <p className="text-xs text-slate-400">
            Las rondas que manden desde las mesas aparecen acá solas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((c) => {
            const minutos = minutosDesde(c.fecha, ahora);
            const demorada = c.estado !== "listo" && minutos >= MINUTOS_ALERTA;
            return (
              <article
                key={c.id}
                className={`flex flex-col rounded-xl border-2 bg-white shadow-sm ${
                  c.estado === "listo"
                    ? "border-slate-200 opacity-60"
                    : demorada
                      ? "border-red-300"
                      : c.estado === "preparando"
                        ? "border-amber-300"
                        : "border-[#4FAEB2]"
                }`}
              >
                <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{c.titulo}</h2>
                    <p className="text-[11px] text-slate-500">
                      Ronda {c.ronda}
                      {c.de_venta && " · mostrador"}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${
                      demorada ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {minutos} min
                  </span>
                </header>

                <ul className="flex-1 divide-y divide-slate-50 px-4 py-2">
                  {c.items.map((it, i) => (
                    <li key={`${c.id}-${i}`} className="py-1.5">
                      <span className="text-base text-slate-800">
                        <strong className="tabular-nums">{it.cantidad}×</strong> {it.producto_nombre}
                      </span>
                      {it.observacion && (
                        <span className="block text-sm italic text-amber-700">{it.observacion}</span>
                      )}
                    </li>
                  ))}
                </ul>

                {c.observacion && (
                  <p className="mx-4 mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {c.observacion}
                  </p>
                )}

                <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
                  {c.estado === "pendiente" && (
                    <button
                      type="button"
                      disabled={tocando === c.id}
                      onClick={() => marcar(c, "preparando")}
                      className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Empezar
                    </button>
                  )}
                  {c.estado !== "listo" && (
                    <button
                      type="button"
                      disabled={tocando === c.id}
                      onClick={() => marcar(c, "listo")}
                      className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Listo
                    </button>
                  )}
                  {c.estado === "listo" && (
                    <>
                      <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" aria-hidden /> {ESTADO_LABEL.listo}
                      </span>
                      <button
                        type="button"
                        disabled={tocando === c.id}
                        onClick={() => marcar(c, "pendiente")}
                        title="Volver a ponerla en espera"
                        className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reabrir
                      </button>
                    </>
                  )}
                  {!c.de_venta && (
                    <Link
                      href={`/ventas/mesas/${c.pedido_id}`}
                      title="Abrir la cuenta de la mesa para cobrarla"
                      className="flex items-center gap-1 rounded-lg border border-[#4FAEB2]/40 px-3 py-2 text-xs font-semibold text-[#2F6F72] hover:bg-[#4FAEB2]/10"
                    >
                      <Receipt className="h-3.5 w-3.5" aria-hidden /> Cobrar
                    </Link>
                  )}
                  {!c.de_venta && (
                    <a
                      href={`/api/mesas/${c.pedido_id}/comanda?ronda=${c.ronda}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Imprimir esta comanda"
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                    >
                      <Printer className="h-4 w-4" aria-hidden />
                    </a>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        ¿Falta algo? Se carga desde{" "}
        <Link href="/ventas/mesas" className="text-[#4FAEB2] hover:underline">
          Mesas
        </Link>
        . Para cobrar,{" "}
        <Link href="/ventas/por-cobrar" className="text-[#4FAEB2] hover:underline">
          Por cobrar
        </Link>
        .
      </p>
    </div>
  );
}
