"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BadgeDollarSign, Clock } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { MesaCobro } from "@/lib/mesas/por-cobrar";

/**
 * El aviso de la Caja: hay mesas esperando que alguien las cobre.
 *
 * El mozo cierra la mesa en el salón y se va a atender; el cajero está en otra
 * pantalla y en otro aparato. Si el único lugar donde aparece la mesa cerrada
 * es la pantalla del salón, el cliente espera en la caja sin que nadie se
 * entere. Por eso el aviso vive acá, donde el cajero ya está mirando.
 *
 * Sólo cuenta las mesas CERRADAS: una mesa abierta con consumo todavía no pidió
 * la cuenta, y avisar por ella sería ruido toda la noche.
 */

const REFRESCO_MS = 15000;

const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;

function minutosDesde(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export default function MesasPorCobrarCaja() {
  const [mesas, setMesas] = useState<MesaCobro[]>([]);

  useEffect(() => {
    // La Caja la mira más de una persona: sin refresco, el cajero no ve la
    // mesa que el mozo acaba de cerrar.
    let vivo = true;
    const pedir = async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/mesas/por-cobrar", { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!vivo || !res.ok || !j?.success) return;
        const todas = (j.data?.mesas ?? []) as MesaCobro[];
        setMesas(todas.filter((m) => m.estado === "esperando_cobro"));
      } catch {
        /* Un error de red no tiene que romper la Caja: el aviso vuelve solo. */
      }
    };
    pedir();
    const t = setInterval(pedir, REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  // Sin mesas esperando no hay nada que avisar, y la Caja no gana un cartel vacío.
  if (mesas.length === 0) return null;

  const total = mesas.reduce((a, m) => a + (Number(m.total) || 0), 0);
  const masVieja = mesas.reduce(
    (peor, m) => Math.max(peor, minutosDesde(m.espera_desde)),
    0
  );

  return (
    <Link
      href="/ventas/por-cobrar"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#4FAEB2] bg-[#4FAEB2]/10 p-4 shadow-sm transition-colors hover:bg-[#4FAEB2]/15"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#2F6F72]">
          <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden /> Mesas por cobrar
        </p>
        <p className="mt-1 text-sm text-slate-700">
          <strong className="text-base text-slate-900">
            {mesas.length} {mesas.length === 1 ? "mesa" : "mesas"}
          </strong>{" "}
          esperando cobro · <span className="font-semibold tabular-nums">{fmtGs(total)}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {mesas
            .slice(0, 4)
            .map((m) => `Mesa ${m.mesa}`)
            .join(" · ")}
          {mesas.length > 4 ? ` +${mesas.length - 4}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {masVieja >= 10 && (
          <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {masVieja} min esperando
          </span>
        )}
        <span className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white">
          Cobrar →
        </span>
      </div>
    </Link>
  );
}
