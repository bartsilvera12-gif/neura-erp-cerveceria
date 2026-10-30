"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AlertTriangle, ArrowLeft, ArrowRight, Factory, Loader2, X } from "lucide-react";
import { useRolErp } from "@/lib/auth/use-rol-erp";
import { puedeEditarRecetas } from "@/lib/roles/erp-role-access";
import { ETAPA_LABEL, siguienteEtapa } from "@/lib/produccion/lotes-pg";
import { abvEstimado, atenuacion, ogFg } from "@/lib/produccion/densidad";
import { Thermometer, Trash2 } from "lucide-react";

import NumeroInput from "@/components/ui/NumeroInput";
type Lote = {
  id: string;
  codigo: string;
  estado: string;
  receta_id: string | null;
  receta_nombre: string | null;
  fermentador_codigo: string | null;
  fermentador_capacidad: number | null;
  producto_granel_nombre: string | null;
  producto_granel_unidad: string | null;
  volumen_planificado: number | null;
  volumen_obtenido: number | null;
  volumen_envasado: number;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin: string | null;
  responsable_nombre: string | null;
  observaciones: string | null;
};

type Etapa = { id: string; etapa: string; fecha: string; usuario_nombre: string | null; nota: string | null };
type Envasado = {
  id: string;
  producto_nombre: string;
  cantidad: number;
  litros: number;
  costo_unitario: number;
  fecha: string;
};
type Formato = {
  producto_id: string;
  producto_nombre: string;
  capacidad: number;
  capacidad_unidad: string;
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return Number(n).toLocaleString("es-PY", { maximumFractionDigits: 2 });
}
function fmtGs(n: number | null | undefined) {
  if (n == null) return "—";
  return `Gs. ${Math.round(Number(n)).toLocaleString("es-PY")}`;
}
function fmtFechaHora(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
}

type Medicion = {
  id: string;
  fecha: string;
  etapa: string | null;
  densidad: number | null;
  temperatura: number | null;
  ph: number | null;
  nota: string | null;
  usuario_nombre: string | null;
};

export default function LoteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const { rol } = useRolErp();
  const puedeEditar = puedeEditarRecetas(rol);

  const [lote, setLote] = useState<Lote | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [envasado, setEnvasado] = useState<Envasado[]>([]);
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [volumenKnockout, setVolumenKnockout] = useState<number>(0);
  const [notaEtapa, setNotaEtapa] = useState("");
  const [envProductoId, setEnvProductoId] = useState("");
  const [envCantidad, setEnvCantidad] = useState<number>(1);

  // Mediciones de fermentación. Lo que el cervecero mide todos los días.
  const [mediciones, setMediciones] = useState<Medicion[]>([]);
  const [medDensidad, setMedDensidad] = useState("");
  const [medTemp, setMedTemp] = useState("");
  const [medPh, setMedPh] = useState("");
  const [medNota, setMedNota] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetchWithSupabaseSession(`/api/produccion/lotes/${id}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "No se pudo cargar el lote.");
      return;
    }
    const l = body.data.lote as Lote;
    setLote(l);
    setEtapas((body.data.etapas ?? []) as Etapa[]);
    setEnvasado((body.data.envasado ?? []) as Envasado[]);
    setFormatos((body.data.formatos ?? []) as Formato[]);

    const resMed = await fetchWithSupabaseSession(`/api/produccion/lotes/${id}/mediciones`, {
      cache: "no-store",
    });
    const bodyMed = await resMed.json().catch(() => ({}));
    // Sin la tabla (script 23 sin correr) el resto de la pantalla funciona igual.
    setMediciones(resMed.ok && bodyMed?.success ? ((bodyMed.data?.mediciones ?? []) as Medicion[]) : []);
    if (!volumenKnockout) {
      setVolumenKnockout(l.volumen_obtenido ?? l.volumen_planificado ?? 0);
    }
  }, [id, volumenKnockout]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
    // refresh cambia con volumenKnockout, que no debe disparar recargas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function accion(url: string, payload: unknown, msgError: string) {
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

  async function guardarMedicion() {
    const ok = await accion(
      `/api/produccion/lotes/${id}/mediciones`,
      { densidad: medDensidad, temperatura: medTemp, ph: medPh, nota: medNota },
      "No se pudo guardar la medición."
    );
    if (ok) {
      setMedDensidad("");
      setMedTemp("");
      setMedPh("");
      setMedNota("");
    }
  }

  async function borrarMedicion(medicionId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/produccion/lotes/${id}/mediciones?medicion=${encodeURIComponent(medicionId)}`,
        { method: "DELETE" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo borrar la medición.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (!lote) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error ?? "Lote no encontrado"}
        </div>
      </div>
    );
  }

  const sinEnvasar =
    lote.volumen_obtenido != null ? lote.volumen_obtenido - (lote.volumen_envasado ?? 0) : null;
  const mermaPct =
    lote.volumen_obtenido && lote.volumen_obtenido > 0 && sinEnvasar != null
      ? (sinEnvasar / lote.volumen_obtenido) * 100
      : null;
  const proxima = siguienteEtapa(lote.estado);
  const terminado = lote.estado === "cerrado" || lote.estado === "cancelado";
  const formatoElegido = formatos.find((f) => f.producto_id === envProductoId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href="/dashboard/produccion"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Volver a Producción
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Factory className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{lote.codigo}</h1>
            <p className="text-sm text-gray-500">
              {lote.receta_nombre ?? "sin receta"}
              {lote.fermentador_codigo ? ` · ${lote.fermentador_codigo}` : ""}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
          {ETAPA_LABEL[lote.estado] ?? lote.estado}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* ── RESUMEN ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Previsto</div>
          <div className="text-lg font-semibold">{fmtNum(lote.volumen_planificado)} L</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Obtenido</div>
          <div className="text-lg font-semibold">{fmtNum(lote.volumen_obtenido)} L</div>
          <div className="text-xs text-gray-500">knockout</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Envasado</div>
          <div className="text-lg font-semibold">{fmtNum(lote.volumen_envasado)} L</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase text-gray-500">Merma</div>
          <div className="text-lg font-semibold text-gray-900">
            {sinEnvasar == null ? "—" : `${fmtNum(sinEnvasar)} L`}
          </div>
          <div className="text-xs text-gray-500">
            {mermaPct == null ? "sin volumen cargado" : `${mermaPct.toFixed(1)} % del lote`}
          </div>
        </div>
      </div>

      {/* ── COCIMIENTO ──────────────────────────────────────────────────── */}
      {puedeEditar && lote.estado === "planificado" && (
        <div className="rounded-md border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="text-sm font-semibold text-orange-900">Registrar cocimiento</h2>
          <p className="mt-1 text-xs text-orange-800">
            Descuenta los insumos de la receta y da de alta los litros obtenidos como
            {lote.producto_granel_nombre ? ` “${lote.producto_granel_nombre}”` : " producto en proceso"}.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-orange-900">
                Litros obtenidos (knockout)
              </label>
              <NumeroInput
                value={volumenKnockout}
                onChange={setVolumenKnockout}
                min={0}
                className="w-full rounded-md border border-orange-300 px-3 py-2 text-sm"
                aria-label="Volumen obtenido en el knockout"
              />
            </div>
            <button
              type="button"
              disabled={volumenKnockout <= 0 || busy}
              onClick={() =>
                void accion(
                  `/api/produccion/lotes/${id}/cocimiento`,
                  { volumen_obtenido: volumenKnockout },
                  "No se pudo registrar el cocimiento."
                )
              }
              className="rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {busy ? "Registrando…" : "Registrar cocimiento"}
            </button>
          </div>
        </div>
      )}

      {/* ── ENVASADO ────────────────────────────────────────────────────── */}
      {lote.estado === "envasado" && puedeEditar && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4">
          <h2 className="text-sm font-semibold text-emerald-900">Envasar</h2>
          <p className="mt-1 text-xs text-emerald-800">
            Descuenta litros del granel y da de alta las unidades del formato.
            {sinEnvasar != null && ` Quedan ${fmtNum(sinEnvasar)} L sin envasar.`}
          </p>
          {formatos.length === 0 ? (
            <p className="mt-2 text-xs text-emerald-900">
              La receta no tiene formatos cargados. Agregalos desde la receta para poder envasar.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-emerald-900">Formato</label>
                <select
                  value={envProductoId}
                  onChange={(e) => setEnvProductoId(e.target.value)}
                  className="w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Elegí —</option>
                  {formatos.map((f) => (
                    <option key={f.producto_id} value={f.producto_id}>
                      {f.producto_nombre} ({fmtNum(f.capacidad)} {f.capacidad_unidad})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-emerald-900">Cantidad</label>
                <NumeroInput
                  value={envCantidad}
                  onChange={setEnvCantidad}
                  min={0}
                  decimales={false}
                  className="w-full rounded-md border border-emerald-300 px-3 py-2 text-sm"
                  aria-label="Cantidad a envasar"
                />
              </div>
              <button
                type="button"
                disabled={!envProductoId || envCantidad <= 0 || busy}
                onClick={async () => {
                  const ok = await accion(
                    `/api/produccion/lotes/${id}/envasado`,
                    { producto_id: envProductoId, cantidad: envCantidad },
                    "No se pudo registrar el envasado."
                  );
                  if (ok) setEnvCantidad(1);
                }}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Envasar
              </button>
              {formatoElegido && (
                <p className="w-full text-xs text-emerald-800">
                  Consume {fmtNum(envCantidad * formatoElegido.capacidad)}{" "}
                  {formatoElegido.capacidad_unidad} de granel.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AVANZAR ETAPA ───────────────────────────────────────────────── */}
      {puedeEditar && !terminado && lote.estado !== "planificado" && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white p-4">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Nota de la etapa (opcional)
            </label>
            <input
              value={notaEtapa}
              onChange={(e) => setNotaEtapa(e.target.value)}
              placeholder="OG 1.045, pH 5,3…"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {proxima && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await accion(
                  `/api/produccion/lotes/${id}/etapa`,
                  { nota: notaEtapa || null },
                  "No se pudo avanzar la etapa."
                );
                if (ok) setNotaEtapa("");
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              Pasar a {ETAPA_LABEL[proxima] ?? proxima} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void accion(
                `/api/produccion/lotes/${id}/etapa`,
                { cancelar: true, nota: notaEtapa || null },
                "No se pudo cancelar el lote."
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <X className="h-4 w-4" /> Cancelar lote
          </button>
        </div>
      )}

      {/* ── ENVASES DEL LOTE ────────────────────────────────────────────── */}
      {envasado.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white">
          <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
            Envasado
          </h2>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Formato</th>
                <th className="px-4 py-2 text-right font-medium">Unidades</th>
                <th className="px-4 py-2 text-right font-medium">Litros</th>
                <th className="px-4 py-2 text-right font-medium">Costo unitario</th>
                <th className="px-4 py-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {envasado.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2">{e.producto_nombre}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(e.cantidad)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(e.litros)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtGs(e.costo_unitario)}</td>
                  <td className="px-4 py-2 text-gray-500">{fmtFechaHora(e.fecha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MEDICIONES ──────────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 bg-white">
        <h2 className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
          <Thermometer className="h-4 w-4 text-[#4FAEB2]" aria-hidden /> Fermentación
        </h2>

        {/* El alcohol no se carga a mano: sale de la primera y la última
            densidad medidas. Con una sola medición todavía no hay FG. */}
        {(() => {
          const { og, fg } = ogFg(mediciones);
          const abv = abvEstimado(og, fg);
          const aten = atenuacion(og, fg);
          if (og == null) return null;
          return (
            <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-gray-100 px-4 py-3 text-sm">
              <div>
                <div className="text-xs uppercase text-gray-500">Densidad inicial</div>
                <div className="font-semibold tabular-nums text-gray-800">{og.toFixed(3)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Densidad final</div>
                <div className="font-semibold tabular-nums text-gray-800">
                  {fg == null ? "—" : fg.toFixed(3)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Alcohol estimado</div>
                <div className="font-semibold tabular-nums text-gray-800">
                  {abv == null ? "—" : `${abv.toFixed(2)} %`}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Atenuación</div>
                <div className="font-semibold tabular-nums text-gray-800">
                  {aten == null ? "—" : `${aten} %`}
                </div>
              </div>
              {fg == null && (
                <p className="w-full text-xs text-gray-500">
                  Con una sola medición todavía no hay densidad final: el alcohol sale cuando cargues
                  la del día que se mide para envasar.
                </p>
              )}
            </div>
          );
        })()}

        {puedeEditar && (
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Densidad (SG)</label>
                <input
                  value={medDensidad}
                  onChange={(e) => setMedDensidad(e.target.value)}
                  placeholder="1.048"
                  inputMode="decimal"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Temperatura (°C)</label>
                <input
                  value={medTemp}
                  onChange={(e) => setMedTemp(e.target.value)}
                  placeholder="18"
                  inputMode="decimal"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">pH</label>
                <input
                  value={medPh}
                  onChange={(e) => setMedPh(e.target.value)}
                  placeholder="4.4"
                  inputMode="decimal"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Nota</label>
                <input
                  value={medNota}
                  onChange={(e) => setMedNota(e.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={guardarMedicion}
              disabled={busy}
              className="mt-3 rounded bg-[#4FAEB2] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
            >
              Registrar medición
            </button>
          </div>
        )}

        {mediciones.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">
            Sin mediciones todavía.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Etapa</th>
                  <th className="px-4 py-2 text-right font-medium">Densidad</th>
                  <th className="px-4 py-2 text-right font-medium">Temp.</th>
                  <th className="px-4 py-2 text-right font-medium">pH</th>
                  <th className="px-4 py-2 font-medium">Nota</th>
                  {puedeEditar && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {mediciones.map((m) => (
                  <tr key={m.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 text-gray-600">{fmtFechaHora(m.fecha)}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {m.etapa ? ETAPA_LABEL[m.etapa] ?? m.etapa : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.densidad == null ? "—" : Number(m.densidad).toFixed(3)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.temperatura == null ? "—" : `${m.temperatura} °C`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {m.ph == null ? "—" : m.ph}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">{m.nota ?? ""}</td>
                    {puedeEditar && (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => borrarMedicion(m.id)}
                          title="Borrar esta medición"
                          aria-label="Borrar medición"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── HISTORIAL ───────────────────────────────────────────────────── */}
      <div className="rounded-md border border-gray-200 bg-white">
        <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
          Historial del lote
        </h2>
        {etapas.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Sin movimientos todavía.</p>
        ) : (
          <ol className="divide-y divide-gray-50">
            {etapas.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium text-gray-800">{ETAPA_LABEL[e.etapa] ?? e.etapa}</span>
                <span className="text-xs text-gray-500">{fmtFechaHora(e.fecha)}</span>
                {e.usuario_nombre && (
                  <span className="text-xs text-gray-400">· {e.usuario_nombre}</span>
                )}
                {e.nota && <span className="w-full text-xs text-gray-600">{e.nota}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
