"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AlertTriangle, Container, Factory, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useDialogos } from "@/components/ui/Dialogos";
import { useRolErp } from "@/lib/auth/use-rol-erp";
import { puedeEditarRecetas } from "@/lib/roles/erp-role-access";
import { ETAPA_LABEL } from "@/lib/produccion/lotes-pg";

import NumeroInput from "@/components/ui/NumeroInput";
type Lote = {
  id: string;
  codigo: string;
  estado: string;
  volumen_planificado: number | null;
  volumen_obtenido: number | null;
  volumen_envasado: number;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fermentador_codigo: string | null;
  receta_nombre: string | null;
  producto_granel_nombre: string | null;
};

type Fermentador = {
  id: string;
  codigo: string;
  nombre: string;
  capacidad_litros: number;
  activo: boolean;
  lote_activo_id: string | null;
  lote_activo_codigo: string | null;
  lote_activo_estado: string | null;
};

type Receta = {
  id: string;
  nombre: string | null;
  producto_id: string;
  producto_nombre: string | null;
  rendimiento_cantidad: number;
};

/** Color por etapa: el estado del lote se lee de un vistazo en la lista. */
const ESTADO_CLASS: Record<string, string> = {
  planificado: "bg-slate-100 text-slate-600",
  cocimiento: "bg-orange-100 text-orange-700",
  fermentacion: "bg-amber-100 text-amber-800",
  maduracion: "bg-sky-100 text-sky-700",
  carbonatacion: "bg-indigo-100 text-indigo-700",
  envasado: "bg-emerald-100 text-emerald-700",
  cerrado: "bg-gray-100 text-gray-500",
  cancelado: "bg-red-100 text-red-700",
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return Number(n).toLocaleString("es-PY", { maximumFractionDigits: 2 });
}

function fmtFecha(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-PY");
}

export default function ProduccionPage() {
  const { rol } = useRolErp();
  const puedeEditar = puedeEditarRecetas(rol);
  const { confirmar, avisar, pedirTexto } = useDialogos();

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [fermentadores, setFermentadores] = useState<Fermentador[]>([]);
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Borrar un lote PLANIFICADO. El servidor rechaza cualquier otro: desde el
   * cocimiento el lote consumió materia prima y borrarlo dejaría ese consumo
   * sin nada que lo explique.
   */
  async function borrarLote(id: string, codigoLote: string, estado: string) {
    if (estado !== "planificado") {
      await avisar({
        titulo: `El lote ${codigoLote} ya arrancó`,
        mensaje:
          "Consumió materia prima, así que borrarlo dejaría ese consumo sin explicación. " +
          "Abrí el lote y cancelalo: libera el fermentador y deja el rastro.",
        tono: "peligro",
      });
      return;
    }
    const seguir = await confirmar({
      titulo: `Borrar el lote ${codigoLote}`,
      mensaje: "Todavía no arrancó, así que no se pierde ningún movimiento. No se puede deshacer.",
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguir) return;
    await accion(`/api/produccion/lotes/${id}`, { method: "DELETE" }, "No se pudo borrar el lote.");
  }

  /** Editar un fermentador: lo que se cambia a mano es el nombre y la capacidad. */
  async function editarFermentador(f: Fermentador) {
    const nombre = await pedirTexto({
      titulo: `Fermentador ${f.codigo}`,
      mensaje: "Nombre del tanque",
      valorInicial: f.nombre,
      confirmar: "Siguiente",
      minimo: 1,
    });
    if (nombre == null) return;
    const capacidad = await pedirTexto({
      titulo: `Fermentador ${f.codigo}`,
      mensaje: "Capacidad en litros",
      valorInicial: String(f.capacidad_litros),
      confirmar: "Guardar",
    });
    if (capacidad == null) return;
    const litros = Number(String(capacidad).replace(",", "."));
    if (!Number.isFinite(litros) || litros <= 0) {
      await avisar({ mensaje: "La capacidad tiene que ser un número mayor a 0.", tono: "peligro" });
      return;
    }
    await accion(
      `/api/produccion/fermentadores/${f.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), capacidad_litros: litros }),
      },
      "No se pudo guardar el fermentador."
    );
  }

  /** Borrar un fermentador. El servidor lo rechaza si alguna vez fermentó algo. */
  async function borrarFermentador(f: Fermentador) {
    const seguir = await confirmar({
      titulo: `Borrar el fermentador ${f.codigo}`,
      mensaje:
        "Sólo se puede si nunca se usó. Si ya fermentó algún lote, el sistema no te va a dejar: " +
        "en ese caso el tanque se desactiva para no perder el historial.",
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguir) return;
    await accion(
      `/api/produccion/fermentadores/${f.id}`,
      { method: "DELETE" },
      "No se pudo borrar el fermentador."
    );
  }

  /** Pide, muestra el error del server tal cual y recarga. */
  async function accion(url: string, init: RequestInit, fallback: string) {
    setBusy(true);
    try {
      const res = await fetchWithSupabaseSession(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        await avisar({ mensaje: body?.error ?? fallback, tono: "peligro" });
        return;
      }
      await refresh();
    } catch {
      await avisar({ mensaje: "Error de red.", tono: "peligro" });
    } finally {
      setBusy(false);
    }
  }

  // Alta de lote
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [recetaId, setRecetaId] = useState("");
  const [fermentadorId, setFermentadorId] = useState("");
  const [volumen, setVolumen] = useState<number>(0);
  const [fechaFin, setFechaFin] = useState("");

  // Alta de fermentador
  const [fermOpen, setFermOpen] = useState(false);
  const [fCodigo, setFCodigo] = useState("");
  const [fNombre, setFNombre] = useState("");
  const [fCapacidad, setFCapacidad] = useState<number>(0);

  const refresh = useCallback(async () => {
    const [lRes, fRes, rRes] = await Promise.all([
      fetchWithSupabaseSession("/api/produccion/lotes", { cache: "no-store" }),
      fetchWithSupabaseSession("/api/produccion/fermentadores", { cache: "no-store" }),
      fetchWithSupabaseSession("/api/recetas", { cache: "no-store" }),
    ]);
    const lBody = await lRes.json().catch(() => ({}));
    if (!lRes.ok || lBody?.success === false) {
      setError(lBody?.error ?? "No se pudieron cargar los lotes.");
      return;
    }
    setError(null);
    setLotes((lBody.data?.lotes ?? []) as Lote[]);

    const fBody = await fRes.json().catch(() => ({}));
    if (fRes.ok && fBody?.success) setFermentadores((fBody.data?.fermentadores ?? []) as Fermentador[]);

    const rBody = await rRes.json().catch(() => ({}));
    if (rRes.ok && rBody?.success) setRecetas((rBody.data?.recetas ?? []) as Receta[]);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  async function post(url: string, payload: unknown, msgError: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? msgError);
        return false;
      }
      await refresh();
      return true;
    } catch {
      setError("Error de red.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const recetaElegida = recetas.find((r) => r.id === recetaId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Factory className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Producción</h1>
            <p className="text-sm text-gray-500">Lotes, fermentadores y envasado</p>
          </div>
        </div>
        {puedeEditar && (
          <button
            type="button"
            onClick={() => setNuevoOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91]"
          >
            <Plus className="h-4 w-4" /> Nuevo lote
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* ── NUEVO LOTE ──────────────────────────────────────────────────── */}
      {nuevoOpen && puedeEditar && (
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Nuevo lote</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Código de lote</label>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="COVEN-BL-2026-001"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Receta</label>
              <select
                value={recetaId}
                onChange={(e) => {
                  setRecetaId(e.target.value);
                  const r = recetas.find((x) => x.id === e.target.value);
                  if (r) setVolumen(r.rendimiento_cantidad);
                }}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— Elegí —</option>
                {recetas.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre?.trim() || r.producto_nombre || "(sin nombre)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Fermentador</label>
              <select
                value={fermentadorId}
                onChange={(e) => setFermentadorId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— Sin asignar —</option>
                {fermentadores
                  .filter((f) => f.activo && !f.lote_activo_id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.codigo} · {fmtNum(f.capacidad_litros)} L
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Volumen previsto (L)</label>
              <NumeroInput
                value={volumen}
                onChange={setVolumen}
                min={0}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                aria-label="Volumen previsto en litros"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Fin estimado</label>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNuevoOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!codigo.trim() || !recetaElegida || busy}
              onClick={async () => {
                const ok = await post(
                  "/api/produccion/lotes",
                  {
                    codigo: codigo.trim(),
                    receta_id: recetaId,
                    producto_granel_id: recetaElegida?.producto_id,
                    fermentador_id: fermentadorId || null,
                    volumen_planificado: volumen > 0 ? volumen : null,
                    fecha_fin_estimada: fechaFin || null,
                  },
                  "No se pudo crear el lote."
                );
                if (ok) {
                  setNuevoOpen(false);
                  setCodigo("");
                  setFermentadorId("");
                  setFechaFin("");
                }
              }}
              className="rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {busy ? "Creando…" : "Crear lote"}
            </button>
          </div>
        </div>
      )}

      {/* ── LOTES ───────────────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
          Lotes
        </h2>
        {lotes.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            Todavía no hay lotes registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Lote</th>
                  <th className="px-4 py-2 font-medium">Receta</th>
                  <th className="px-4 py-2 font-medium">Fermentador</th>
                  <th className="px-4 py-2 font-medium">Etapa</th>
                  <th className="px-4 py-2 text-right font-medium">Obtenido</th>
                  <th className="px-4 py-2 text-right font-medium">Envasado</th>
                  <th className="px-4 py-2 text-right font-medium">Merma</th>
                  <th className="px-4 py-2 font-medium">Inicio</th>
                  {puedeEditar && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => {
                  const merma =
                    l.volumen_obtenido != null
                      ? l.volumen_obtenido - (l.volumen_envasado ?? 0)
                      : null;
                  return (
                    <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/dashboard/produccion/${l.id}`} className="text-[#2F6F72] hover:underline">
                          {l.codigo}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{l.receta_nombre ?? "—"}</td>
                      <td className="px-4 py-2 text-gray-600">{l.fermentador_codigo ?? "—"}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            ESTADO_CLASS[l.estado] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {ETAPA_LABEL[l.estado] ?? l.estado}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(l.volumen_obtenido)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtNum(l.volumen_envasado)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                        {merma == null ? "—" : `${fmtNum(merma)} L`}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{fmtFecha(l.fecha_inicio)}</td>
                      {puedeEditar && (
                        <td className="px-4 py-2 text-right">
                          {/* Sólo el planificado se borra; el resto ya consumió
                              materia prima y se cancela desde su pantalla. */}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => borrarLote(l.id, l.codigo, l.estado)}
                            title={
                              l.estado === "planificado"
                                ? "Borrar este lote"
                                : "Ya arrancó: se cancela desde la pantalla del lote"
                            }
                            aria-label={`Borrar el lote ${l.codigo}`}
                            className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── FERMENTADORES ───────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Container className="h-4 w-4 text-[#4FAEB2]" aria-hidden /> Fermentadores
          </h2>
          {puedeEditar && (
            <button
              type="button"
              onClick={() => setFermOpen((v) => !v)}
              className="text-xs font-medium text-[#2F6F72] hover:underline"
            >
              {fermOpen ? "Cancelar" : "Agregar"}
            </button>
          )}
        </div>

        {fermOpen && puedeEditar && (
          <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 px-4 py-3">
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-gray-600">Código</label>
              <input
                value={fCodigo}
                onChange={(e) => setFCodigo(e.target.value)}
                placeholder="FV-01"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Nombre</label>
              <input
                value={fNombre}
                onChange={(e) => setFNombre(e.target.value)}
                placeholder="Fermentador isobárico 1"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-600">Capacidad (L)</label>
              <NumeroInput
                value={fCapacidad}
                onChange={setFCapacidad}
                min={0}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                aria-label="Capacidad del fermentador en litros"
              />
            </div>
            <button
              type="button"
              disabled={!fCodigo.trim() || !fNombre.trim() || fCapacidad <= 0 || busy}
              onClick={async () => {
                const ok = await post(
                  "/api/produccion/fermentadores",
                  { codigo: fCodigo.trim(), nombre: fNombre.trim(), capacidad_litros: fCapacidad },
                  "No se pudo crear el fermentador."
                );
                if (ok) {
                  setFermOpen(false);
                  setFCodigo("");
                  setFNombre("");
                  setFCapacidad(0);
                }
              }}
              className="rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        )}

        {fermentadores.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
            Sin fermentadores cargados.
          </p>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {fermentadores.map((f) => (
              <li
                key={f.id}
                className={`rounded-lg border p-3 ${
                  f.lote_activo_id ? "border-amber-200 bg-amber-50/60" : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">{f.codigo}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">{fmtNum(f.capacidad_litros)} L</span>
                    {puedeEditar && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => editarFermentador(f)}
                          title="Editar nombre y capacidad"
                          aria-label={`Editar el fermentador ${f.codigo}`}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => borrarFermentador(f)}
                          title="Borrar (sólo si nunca se usó)"
                          aria-label={`Borrar el fermentador ${f.codigo}`}
                          className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">{f.nombre}</p>
                <p className="mt-2 text-xs">
                  {f.lote_activo_id ? (
                    <Link
                      href={`/dashboard/produccion/${f.lote_activo_id}`}
                      className="font-medium text-amber-800 hover:underline"
                    >
                      Ocupado · {f.lote_activo_codigo} (
                      {ETAPA_LABEL[f.lote_activo_estado ?? ""] ?? f.lote_activo_estado})
                    </Link>
                  ) : (
                    <span className="font-medium text-emerald-700">Libre</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
