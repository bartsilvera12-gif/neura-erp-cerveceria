"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, ShoppingBag, Trash2, UtensilsCrossed, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { useDialogos } from "@/components/ui/Dialogos";
import { usePuedeCobrar } from "@/lib/modulos/use-puede-cobrar";
import { etiquetaNombreCuenta, type ModalidadMesa } from "@/lib/mesas/mesas-domain";
import type { MesaSalon } from "@/lib/mesas/salon";

/**
 * El salón.
 *
 * Las mesas de un bar son siempre las mismas: se cargan una vez y quedan. Tocar
 * una mesa libre abre su cuenta sin preguntar nada; tocar una ocupada entra a
 * la cuenta. Antes había que escribir el nombre de la mesa cada vez, y además
 * de ser una traba terminaba con la misma mesa escrita de tres formas.
 *
 * Una cuenta abierta no mueve stock ni plata: eso pasa al servir cada ronda y
 * al cobrar en Caja.
 */

type Resumen = { libres: number; ocupadas: number; en_caja: number; total_abierto: number };

const fmtGs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

/** "hace 1 h 20 min" — lo que el mozo mira para saber a quién atender. */
function desdeHace(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `hace ${h} h${resto > 0 ? ` ${resto} min` : ""}`;
}

export default function MesasPage() {
  const router = useRouter();
  const { avisar, confirmar, pedirTexto } = useDialogos();
  const { puedeCobrar } = usePuedeCobrar();

  const [mesas, setMesas] = useState<MesaSalon[]>([]);
  const [paraLlevar, setParaLlevar] = useState<MesaSalon[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [sinCatalogo, setSinCatalogo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession("/api/mesas/catalogo", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        setError(j?.error ?? `No se pudo cargar el salón (${res.status}).`);
        return;
      }
      setError(null);
      setMesas((j.data?.mesas ?? []) as MesaSalon[]);
      setParaLlevar((j.data?.para_llevar ?? []) as MesaSalon[]);
      setResumen((j.data?.resumen ?? null) as Resumen | null);
      setSinCatalogo(j.data?.sin_catalogo === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    // El salón lo miran varias personas a la vez: sin refresco, el mozo que
    // abre la mesa 4 no aparece en la pantalla del otro.
    const t = setInterval(() => void cargar(), 20000);
    return () => clearInterval(t);
  }, [cargar]);

  /** Abrir la cuenta de una mesa del salón: sin preguntar, la mesa ya tiene nombre. */
  async function abrirCuenta(nombre: string, modalidad: ModalidadMesa = "local") {
    setOcupado(nombre);
    try {
      const res = await fetchWithSupabaseSession("/api/mesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesa: nombre, modalidad }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo abrir la cuenta.", tono: "peligro" });
        return;
      }
      router.push(`/ventas/mesas/${j.data.mesa.id}`);
    } finally {
      setOcupado(null);
    }
  }

  /** Un pedido para llevar no es una mesa: se pide el nombre de quien lo retira. */
  async function nuevoParaLlevar() {
    const nombre = await pedirTexto({
      titulo: "Pedido para llevar",
      mensaje: etiquetaNombreCuenta("carry_out"),
      placeholder: "Ej: Juan, Pedido 3",
      confirmar: "Abrir",
    });
    if (nombre == null || nombre.trim() === "") return;
    await abrirCuenta(nombre, "carry_out");
  }

  async function agregarMesa() {
    const nombre = await pedirTexto({
      titulo: "Agregar mesa al salón",
      mensaje: "¿Cómo se llama? Queda cargada para siempre.",
      placeholder: "Ej: 5, Barra, Terraza 2",
      confirmar: "Agregar",
    });
    if (nombre == null || nombre.trim() === "") return;
    const res = await fetchWithSupabaseSession("/api/mesas/catalogo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, orden: mesas.length + 1 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.success) {
      await avisar({ mensaje: j?.error ?? "No se pudo agregar la mesa.", tono: "peligro" });
      return;
    }
    await cargar();
  }

  async function renombrarMesa(m: MesaSalon) {
    const nombre = await pedirTexto({
      titulo: `Cambiar el nombre de ${m.nombre}`,
      mensaje: "El nombre nuevo se usa en las cuentas que se abran de ahora en más.",
      valorInicial: m.nombre,
      confirmar: "Guardar",
    });
    if (nombre == null || nombre.trim() === "" || nombre.trim() === m.nombre) return;
    const res = await fetchWithSupabaseSession(`/api/mesas/catalogo/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.success) {
      await avisar({ mensaje: j?.error ?? "No se pudo cambiar el nombre.", tono: "peligro" });
      return;
    }
    await cargar();
  }

  async function borrarMesa(m: MesaSalon) {
    if (m.estado !== "libre") {
      await avisar({
        mensaje: `${m.nombre} tiene una cuenta abierta. Cobrala antes de sacarla del salón.`,
        tono: "peligro",
      });
      return;
    }
    const seguir = await confirmar({
      titulo: `Sacar ${m.nombre} del salón`,
      mensaje: "Las cuentas que ya pasaron por esa mesa no se tocan: queda su nombre en cada una.",
      confirmar: "Sacar",
      tono: "peligro",
    });
    if (!seguir) return;
    const res = await fetchWithSupabaseSession(`/api/mesas/catalogo/${m.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.success) {
      await avisar({ mensaje: j?.error ?? "No se pudo sacar la mesa.", tono: "peligro" });
      return;
    }
    await cargar();
  }

  const colorPorEstado: Record<string, string> = {
    libre: "border-slate-200 bg-white hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5",
    ocupada: "border-[#4FAEB2] bg-[#4FAEB2]/10 hover:bg-[#4FAEB2]/15",
    en_caja: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  };

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
              Zentra · Salón
            </p>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Mesas</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {resumen
              ? `${resumen.libres} libres · ${resumen.ocupadas} ocupadas${
                  resumen.en_caja > 0 ? ` · ${resumen.en_caja} en caja` : ""
                }${resumen.total_abierto > 0 ? ` · ${fmtGs(resumen.total_abierto)} abierto` : ""}`
              : "Tocá una mesa libre para abrir su cuenta."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {puedeCobrar && (
            <Link
              href="/ventas/por-cobrar"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Por cobrar
            </Link>
          )}
          <button
            type="button"
            onClick={nuevoParaLlevar}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50 active:scale-95"
          >
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
            Para llevar
          </button>
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              editando
                ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6F72]"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {editando ? <X className="h-3.5 w-3.5" aria-hidden /> : <Pencil className="h-3.5 w-3.5" aria-hidden />}
            {editando ? "Listo" : "Editar salón"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {sinCatalogo && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Todavía no se cargaron las mesas del salón en la base. Mientras tanto, las cuentas se
          abren escribiendo el nombre de la mesa con el botón <strong>Para llevar</strong> o desde
          una cuenta existente.
        </p>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 px-4 py-16 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : mesas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-16 text-center">
          <UtensilsCrossed className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">El salón no tiene mesas cargadas.</p>
          <button
            type="button"
            onClick={agregarMesa}
            className="mt-3 text-xs font-semibold text-[#4FAEB2] hover:underline"
          >
            Agregar la primera
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mesas.map((m) => {
            const libre = m.estado === "libre";
            return (
              <div
                key={m.id}
                className={`relative rounded-xl border p-4 transition-colors ${colorPorEstado[m.estado]}`}
              >
                {editando && (
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => renombrarMesa(m)}
                      title="Cambiar el nombre"
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => borrarMesa(m)}
                      title="Sacar del salón"
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={ocupado === m.nombre || editando}
                  onClick={() => {
                    if (m.cuenta_id) router.push(`/ventas/mesas/${m.cuenta_id}`);
                    else void abrirCuenta(m.nombre);
                  }}
                  className="block w-full text-left disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-base font-bold text-slate-900">{m.nombre}</span>
                    {m.estado === "en_caja" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        En caja
                      </span>
                    )}
                    {m.fuera_de_catalogo && (
                      <span
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                        title="Esta mesa no está en el salón: viene de una cuenta anterior"
                      >
                        suelta
                      </span>
                    )}
                  </div>

                  {libre ? (
                    <>
                      <div className="mt-2 text-sm font-medium text-slate-400">Libre</div>
                      <div className="mt-1 text-[11px] text-slate-400">Tocá para abrir la cuenta</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-2 text-lg font-semibold tabular-nums text-slate-800">
                        {fmtGs(m.total)}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {m.rondas} {m.rondas === 1 ? "ronda" : "rondas"} · {m.unidades}{" "}
                        {m.unidades === 1 ? "ítem" : "ítems"}
                      </div>
                      <div className="text-[11px] text-slate-400">{desdeHace(m.abierta_at)}</div>
                    </>
                  )}
                </button>
              </div>
            );
          })}

          {editando && (
            <button
              type="button"
              onClick={agregarMesa}
              className="flex min-h-[7rem] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 p-4 text-slate-400 transition-colors hover:border-[#4FAEB2] hover:text-[#4FAEB2]"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="text-xs font-semibold">Agregar mesa</span>
            </button>
          )}
        </div>
      )}

      {paraLlevar.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden /> Para llevar
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {paraLlevar.map((p) => (
              <Link
                key={p.id}
                href={`/ventas/mesas/${p.cuenta_id}`}
                className="rounded-xl border border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
              >
                <span className="text-base font-bold text-slate-900">{p.nombre || "Para llevar"}</span>
                <div className="mt-2 text-lg font-semibold tabular-nums text-slate-800">
                  {fmtGs(p.total)}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {p.unidades} {p.unidades === 1 ? "ítem" : "ítems"} · {desdeHace(p.abierta_at)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
