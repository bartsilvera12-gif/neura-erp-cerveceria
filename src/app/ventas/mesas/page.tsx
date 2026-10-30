"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, UtensilsCrossed } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useDialogos } from "@/components/ui/Dialogos";

/**
 * El salón: las mesas con cuenta abierta.
 *
 * Una mesa es un pedido con sus ítems; cerrarla lo manda a Caja, que es la que
 * cobra y descuenta stock. Mientras está abierta no se movió ni stock ni plata.
 */

type Mesa = {
  id: string;
  mesa: string;
  abierta_at: string;
  rondas: number[];
  total: number;
  items: Array<{ cantidad: number }>;
  facturacion_estado: string | null;
};

const fmtGs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

/** "hace 1 h 20 min" — lo que el mozo mira para saber a quién atender. */
function desdeHace(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso.includes("T") && !iso.endsWith("Z") ? iso : iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `hace ${h} h${resto > 0 ? ` ${resto} min` : ""}`;
}

export default function MesasPage() {
  const router = useRouter();
  const { avisar, pedirTexto } = useDialogos();
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/mesas", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudieron cargar las mesas (${res.status}).`);
        return;
      }
      setError(null);
      setMesas((j.data?.mesas ?? []) as Mesa[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // El salón lo miran varias personas a la vez: sin refresco, el mozo que
    // abre la mesa 4 no aparece en la pantalla del otro.
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  async function abrirMesa() {
    const nombre = await pedirTexto({
      titulo: "Abrir mesa",
      mensaje: "¿Qué mesa?",
      placeholder: "Ej: 5, Barra, Terraza 2",
      confirmar: "Abrir",
    });
    if (nombre == null || nombre.trim() === "") return;
    setAbriendo(true);
    try {
      const res = await fetchWithSupabaseSession("/api/mesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: nombre }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo abrir la mesa.", tono: "peligro" });
        return;
      }
      router.push(`/ventas/mesas/${j.data.mesa.id}`);
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Zentra · Salón
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Mesas</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Cuentas abiertas. Se cobran en Caja al cerrarlas.
          </p>
        </div>
        <button
          type="button"
          onClick={abrirMesa}
          disabled={abriendo}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Abrir mesa
        </button>
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
          <UtensilsCrossed className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">No hay mesas abiertas.</p>
          <button
            type="button"
            onClick={abrirMesa}
            className="mt-3 text-xs font-semibold text-[#4FAEB2] hover:underline"
          >
            Abrir la primera
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mesas.map((m) => {
            const enCaja = m.facturacion_estado === "pendiente_caja";
            const unidades = m.items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0);
            return (
              <Link
                key={m.id}
                href={`/ventas/mesas/${m.id}`}
                className={`rounded-xl border p-4 transition-colors ${
                  enCaja
                    ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
                    : "border-slate-200 bg-white hover:border-[#4FAEB2]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-base font-bold text-slate-900">{m.mesa}</span>
                  {enCaja && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      En caja
                    </span>
                  )}
                </div>
                <div className="mt-2 text-lg font-semibold tabular-nums text-slate-800">
                  {fmtGs(m.total)}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {m.rondas.length} {m.rondas.length === 1 ? "ronda" : "rondas"} · {unidades}{" "}
                  {unidades === 1 ? "ítem" : "ítems"}
                </div>
                <div className="text-[11px] text-slate-400">{desdeHace(m.abierta_at)}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
