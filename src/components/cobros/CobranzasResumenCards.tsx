"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Resumen = { total_pendiente: number; total_vencido: number; cobrado_mes: number; parciales: number };

function fmtGs(n: number) {
  return "Gs. " + Math.round(Number(n) || 0).toLocaleString("es-PY");
}

/**
 * Cobranzas del dashboard: cuentas por cobrar de las ventas a crédito.
 *
 * APARECER Y DESAPARECER ERA EL BUG
 * Antes los cuatro números se dibujaban en cero mientras cargaba y, cuando la
 * respuesta llegaba sin nada por cobrar, la sección se borraba sola. El que
 * miraba veía cuatro indicadores con datos que a los dos segundos no estaban:
 * no se sabía si el sistema se equivocó al mostrarlos o al borrarlos.
 *
 * Ahora no se dibuja nada hasta tener la respuesta, y después se muestra
 * siempre algo: los cuatro números, una línea diciendo que no hay nada por
 * cobrar, o el aviso de que no se pudieron traer. Un espacio vacío no explica
 * nada; una línea que dice "no hay deuda" sí.
 */
export default function CobranzasResumenCards() {
  const [r, setR] = useState<Resumen | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");

  useEffect(() => {
    let vivo = true;
    const pedir = async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/cobros/cuentas", { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok || !j?.success || !j.data?.resumen) {
          setEstado("error");
          return;
        }
        setR(j.data.resumen as Resumen);
        setEstado("listo");
      } catch {
        if (vivo) setEstado("error");
      }
    };
    pedir();
    return () => {
      vivo = false;
    };
  }, []);

  // Mientras no se sabe, no se muestran números: mostrarlos en cero y
  // corregirlos después es lo que hacía parecer que los datos se borraban.
  if (estado === "cargando") return null;

  const encabezado = (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-700">Cobranzas (cuentas por cobrar)</h3>
      <Link href="/pagos" className="text-xs font-medium text-[#4FAEB2] hover:underline">
        Ver Pagos →
      </Link>
    </div>
  );

  if (estado === "error") {
    return (
      <div className="space-y-2">
        {encabezado}
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No se pudieron cargar las cobranzas. Recargá la página para volver a intentarlo.
        </p>
      </div>
    );
  }

  const resumen = r as Resumen;
  const sinDeuda = (resumen.total_pendiente ?? 0) === 0 && (resumen.cobrado_mes ?? 0) === 0;
  if (sinDeuda) {
    return (
      <div className="space-y-2">
        {encabezado}
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No hay cuentas por cobrar: todas las ventas del período se cobraron al contado.
        </p>
      </div>
    );
  }

  const cards = [
    { l: "Pendiente por cobrar", v: fmtGs(resumen.total_pendiente), cls: "border-amber-200 bg-amber-50 text-amber-700" },
    { l: "Vencido", v: fmtGs(resumen.total_vencido), cls: "border-red-200 bg-red-50 text-red-700" },
    { l: "Cobrado este mes", v: fmtGs(resumen.cobrado_mes), cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    { l: "Cuentas parciales", v: String(resumen.parciales ?? 0), cls: "border-sky-200 bg-sky-50 text-sky-700" },
  ];

  return (
    <div className="space-y-2">
      {encabezado}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.l} className={`rounded-xl border p-4 shadow-sm ${c.cls}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{c.l}</div>
            <div className="mt-1 text-xl font-bold">{c.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
