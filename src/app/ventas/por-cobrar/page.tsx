"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeDollarSign, CheckCircle2, Clock, Loader2, Receipt, RotateCcw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useDialogos } from "@/components/ui/Dialogos";
import type { MesaCobro } from "@/lib/mesas/por-cobrar";

/**
 * Por cobrar: la pantalla del cajero.
 *
 * Antes, una mesa cerrada aparecía en la tabla genérica de "pedidos pendientes
 * de facturación" de la Caja, mezclada con presupuestos y sin decir qué mesa
 * era. Acá está lo que el cajero necesita: la mesa, el total, hace cuánto
 * espera, y si la cocina todavía no entregó todo.
 *
 * Cobrar es ir a la venta con el pedido precargado (`/ventas/nueva?pedido_id=`),
 * que es el circuito que ya existía: ahí se elige el método de pago, se emite y
 * la mesa queda facturada. El stock ya bajó al servir cada ronda, así que esa
 * venta no vuelve a descontar.
 */

const REFRESCO_MS = 20000;

/** A partir de acá la mesa esperó demasiado en la caja. */
const MINUTOS_ALERTA = 10;

const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;

function desdeHace(iso: string, ahora: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((ahora - t) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `hace ${h} h${resto > 0 ? ` ${resto} min` : ""}`;
}

type Totales = { esperando: number; abiertas: number; monto_esperando: number; monto_abierto: number };

export default function PorCobrarPage() {
  const router = useRouter();
  const { avisar, confirmar } = useDialogos();
  const [mesas, setMesas] = useState<MesaCobro[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tocando, setTocando] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/mesas/por-cobrar", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudieron cargar las mesas (${res.status}).`);
        return;
      }
      setError(null);
      setMesas((j.data?.mesas ?? []) as MesaCobro[]);
      setTotales((j.data?.totales ?? null) as Totales | null);
    } catch {
      setError("Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // En la caja hay más de una persona cerrando mesas: sin refresco, el cajero
    // no ve la mesa que el mozo acaba de cerrar.
    const t = setInterval(cargar, REFRESCO_MS);
    const reloj = setInterval(() => setAhora(Date.now()), 30000);
    return () => {
      clearInterval(t);
      clearInterval(reloj);
    };
  }, [cargar]);

  /**
   * Cobrar. Una mesa abierta se cierra primero: cobrar sin cerrar dejaría la
   * cuenta viva y el mozo podría seguir cargándole cosas ya cobradas.
   */
  async function cobrar(m: MesaCobro) {
    if (m.sin_entregar > 0) {
      const seguir = await confirmar({
        titulo: `Falta entregar en la mesa ${m.mesa}`,
        mensaje: `Hay ${m.sin_entregar} ${m.sin_entregar === 1 ? "ronda" : "rondas"} que la barra o la cocina no marcaron como entregadas. ¿Cobrar igual?`,
        confirmar: "Cobrar igual",
      });
      if (!seguir) return;
    }
    if (m.estado === "esperando_cobro") {
      router.push(`/ventas/nueva?pedido_id=${encodeURIComponent(m.id)}`);
      return;
    }
    const seguir = await confirmar({
      titulo: `Cerrar y cobrar la mesa ${m.mesa}`,
      mensaje: `Total ${fmtGs(m.total)}. La cuenta se cierra y no se le puede agregar nada más.`,
      confirmar: "Cerrar y cobrar",
    });
    if (!seguir) return;
    setTocando(m.id);
    try {
      const res = await fetchWithSupabaseSession(`/api/mesas/${m.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cerrar" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo cerrar la mesa.", tono: "peligro" });
        return;
      }
      router.push(`/ventas/nueva?pedido_id=${encodeURIComponent(m.id)}`);
    } finally {
      setTocando(null);
    }
  }

  /** La mesa pidió otra vuelta después de pedir la cuenta: vuelve al salón. */
  async function reabrir(m: MesaCobro) {
    const seguir = await confirmar({
      titulo: `Reabrir la mesa ${m.mesa}`,
      mensaje: "Sale de la caja y vuelve al salón con su consumo. Se le pueden agregar rondas de nuevo.",
      confirmar: "Reabrir",
    });
    if (!seguir) return;
    setTocando(m.id);
    try {
      const res = await fetchWithSupabaseSession(`/api/mesas/${m.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "reabrir" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo reabrir la mesa.", tono: "peligro" });
        return;
      }
      await cargar();
    } finally {
      setTocando(null);
    }
  }

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
              Zentra · Caja
            </p>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <BadgeDollarSign className="h-5 w-5 text-[#4FAEB2]" aria-hidden /> Por cobrar
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {totales
              ? `${totales.esperando} ${totales.esperando === 1 ? "mesa esperando" : "mesas esperando"} · ${fmtGs(totales.monto_esperando)}`
              : "Mesas cerradas esperando cobro y abiertas con consumo."}
          </p>
        </div>
        <Link
          href="/ventas/mesas"
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Ir al salón
        </Link>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : mesas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-16 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" aria-hidden />
          <p className="mt-2 text-sm text-slate-600">No hay nada por cobrar.</p>
          <p className="text-xs text-slate-400">
            Las mesas que se cierren en el salón aparecen acá solas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mesas.map((m) => {
            const esperando = m.estado === "esperando_cobro";
            const minutos = Math.max(
              0,
              Math.floor((ahora - new Date(m.espera_desde).getTime()) / 60000)
            );
            const demorada = esperando && minutos >= MINUTOS_ALERTA;
            return (
              <article
                key={m.id}
                className={`flex flex-col rounded-xl border-2 bg-white shadow-sm ${
                  demorada ? "border-red-300" : esperando ? "border-[#4FAEB2]" : "border-slate-200"
                }`}
              >
                <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Mesa {m.mesa}</h2>
                    <p className="text-[11px] text-slate-500">
                      {m.rondas} {m.rondas === 1 ? "ronda" : "rondas"} · {m.unidades}{" "}
                      {m.unidades === 1 ? "ítem" : "ítems"}
                    </p>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${
                      esperando ? "bg-[#4FAEB2]/10 text-[#2F6F72]" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {esperando ? "Cuenta cerrada" : "Abierta"}
                  </span>
                </header>

                <div className="flex-1 space-y-2 px-4 py-3">
                  <p className="text-2xl font-bold tabular-nums text-slate-900">{fmtGs(m.total)}</p>
                  {m.resumen && <p className="text-xs text-slate-500">{m.resumen}</p>}
                  <p
                    className={`flex items-center gap-1 text-[11px] ${
                      demorada ? "font-semibold text-red-700" : "text-slate-400"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {esperando ? "Esperando cobro " : "Abierta "}
                    {desdeHace(m.espera_desde, ahora)}
                  </p>
                  {m.sin_entregar > 0 && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Falta entregar {m.sin_entregar}{" "}
                      {m.sin_entregar === 1 ? "ronda" : "rondas"}.
                    </p>
                  )}
                </div>

                <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
                  <button
                    type="button"
                    disabled={tocando === m.id}
                    onClick={() => cobrar(m)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    <Receipt className="h-4 w-4" aria-hidden />
                    {esperando ? "Cobrar" : "Cerrar y cobrar"}
                  </button>
                  <Link
                    href={`/ventas/mesas/${m.id}`}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Ver cuenta
                  </Link>
                  {esperando && (
                    <button
                      type="button"
                      disabled={tocando === m.id}
                      onClick={() => reabrir(m)}
                      title="Vuelve al salón para agregarle más"
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
