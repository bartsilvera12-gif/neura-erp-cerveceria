"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type EntidadBancariaLite = { id: string; codigo: string | null; nombre: string; tipo: string | null };

/**
 * Alta rápida de una entidad bancaria desde el formulario de cobro/pago.
 * Antes, si la lista estaba vacía, el usuario quedaba trabado: el método
 * Transferencia/Tarjeta exige entidad y no había forma de cargarla sin salir.
 */
export default function NuevaEntidadBancariaInline({
  tipo,
  onCreada,
}: {
  /** banco (transferencia) · tarjeta (procesadora/POS) */
  tipo: "banco" | "tarjeta" | "billetera";
  onCreada: (e: EntidadBancariaLite) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const n = nombre.trim();
    if (!n) { setError("Escribí el nombre."); return; }
    setGuardando(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/entidades-bancarias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: n, tipo }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success || !j.data?.entidad) {
        setError(j?.error ?? "No se pudo crear la entidad.");
        return;
      }
      onCreada(j.data.entidad as EntidadBancariaLite);
      setNombre("");
      setAbierto(false);
    } catch {
      setError("No se pudo crear la entidad.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#4FAEB2] hover:underline"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {tipo === "tarjeta" ? "Agregar procesadora / banco" : "Agregar entidad bancaria"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex gap-2">
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void guardar(); }
            if (e.key === "Escape") { e.preventDefault(); setAbierto(false); }
          }}
          placeholder={tipo === "tarjeta" ? "Ej.: Bancard" : "Ej.: Banco Itaú"}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={guardando}
          onClick={() => void guardar()}
          className="shrink-0 rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setError(null); }}
          className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-1 text-[11px] text-slate-400">También se gestionan en Configuración → Entidades bancarias.</p>
    </div>
  );
}
