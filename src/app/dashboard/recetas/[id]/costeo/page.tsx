"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import NumeroInput from "@/components/ui/NumeroInput";
import { useRolErp } from "@/lib/auth/use-rol-erp";
import { puedeEditarRecetas } from "@/lib/roles/erp-role-access";
import {
  CATEGORIAS_OPERACION,
  ETIQUETA_CATEGORIA,
  type CategoriaOperacion,
  type ResultadoCosteo,
} from "@/lib/recetas/costeo-completo";

/**
 * Costeo completo de una receta: lo que cuesta el lote y lo que cuesta
 * envasarlo en cada formato.
 *
 * Es una pantalla aparte y no una sección más de la receta porque responde
 * otra pregunta. La receta contesta "qué lleva y cuánto rinde"; esto contesta
 * "a cuánto lo tengo que vender". Son dos momentos distintos y dos personas
 * distintas: la receta la toca el cervecero, el precio lo mira la gerencia.
 */

type Linea = { id?: string; categoria: CategoriaOperacion; concepto: string; monto_gs: number };
type FormatoEdit = {
  formato_id: string;
  producto_nombre: string;
  costo_envase: number;
  costo_tapa: number;
  costo_etiqueta: number;
  costo_pack: number;
  velocidad_unid_hora: number | null;
  operarios: number;
  rendimiento_packaging: number;
};
type Parametros = {
  tarifa_mo_hora_gs: number;
  margen_mayorista_pct: number;
  margen_directo_pct: number;
};

const gs = (n: number | null | undefined) =>
  n == null ? "—" : "Gs. " + Math.round(n).toLocaleString("es-PY");
const pct = (n: number | null | undefined, dec = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(dec)} %`;

const inputCls =
  "w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-right tabular-nums " +
  "outline-none focus:border-[#4FAEB2] focus:ring-1 focus:ring-[#4FAEB2]";

export default function CosteoRecetaPage() {
  const { id } = useParams<{ id: string }>();
  const { rol } = useRolErp();
  const puedeEditar = puedeEditarRecetas(rol);

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [resultado, setResultado] = useState<ResultadoCosteo | null>(null);
  const [operacion, setOperacion] = useState<Linea[]>([]);
  const [formatos, setFormatos] = useState<FormatoEdit[]>([]);
  const [parametros, setParametros] = useState<Parametros>({
    tarifa_mo_hora_gs: 0,
    margen_mayorista_pct: 0.4,
    margen_directo_pct: 0.45,
  });

  const aplicar = useCallback((d: Record<string, unknown>) => {
    const receta = d.receta as { nombre?: string; producto_nombre?: string } | undefined;
    setNombre(receta?.nombre || receta?.producto_nombre || "Receta");
    setResultado(d.resultado as ResultadoCosteo);
    setOperacion((d.operacion as Linea[]) ?? []);
    setFormatos(
      ((d.formatos as Record<string, unknown>[]) ?? []).map((f) => ({
        formato_id: String(f.formato_id),
        producto_nombre: String(f.producto_nombre),
        costo_envase: Number(f.costo_envase ?? 0),
        costo_tapa: Number(f.costo_tapa ?? 0),
        costo_etiqueta: Number(f.costo_etiqueta ?? 0),
        costo_pack: Number(f.costo_pack ?? 0),
        velocidad_unid_hora: f.velocidad_unid_hora == null ? null : Number(f.velocidad_unid_hora),
        operarios: Number(f.operarios ?? 1),
        rendimiento_packaging: Number(f.rendimiento_packaging ?? 1),
      }))
    );
    setParametros(d.parametros as Parametros);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetchWithSupabaseSession(`/api/recetas/${id}/costeo`);
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok || !j?.success) {
          setError(j?.error ?? "No se pudo cargar el costeo.");
          return;
        }
        aplicar(j.data);
      } catch {
        if (vivo) setError("Error de red.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [id, aplicar]);

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/recetas/${id}/costeo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operacion, formatos, parametros }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo guardar.");
        return;
      }
      aplicar(j.data);
      setAviso("Guardado.");
    } catch {
      setError("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  const setLinea = (i: number, patch: Partial<Linea>) =>
    setOperacion((prev) => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setFormato = (i: number, patch: Partial<FormatoEdit>) =>
    setFormatos((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
      </div>
    );
  }

  const r = resultado;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/recetas/${id}`}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver a la receta
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Costeo de {nombre}</h1>
          <p className="text-sm text-slate-500">
            Insumos, lo que cuesta hacer el lote y lo que cuesta envasarlo.
          </p>
        </div>
        {puedeEditar && (
          <button
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {aviso && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</p>
      )}

      {r && r.rendimiento_envasable <= 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Esta receta no tiene rendimiento cargado, así que no se puede repartir el costo por
          litro ni calcular unidades por formato. Cargalo en la receta y volvé.
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {r && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta titulo="Costo del lote" valor={gs(r.costo_lote_gs)}
            pie={`${gs(r.costo_insumos_gs)} de insumos + ${gs(r.costo_operacion_gs)} de operación`} />
          <Tarjeta titulo="Litros vendibles" valor={r.rendimiento_envasable.toLocaleString("es-PY")}
            pie={`de ${r.rendimiento.toLocaleString("es-PY")} brutos`} />
          <Tarjeta titulo="Costo por litro" valor={gs(r.costo_por_litro_envasable)}
            pie="sobre los litros vendibles" />
          <Tarjeta titulo="Peso de los insumos" valor={pct(r.composicion.insumos)}
            pie={`MO ${pct(r.composicion.mano_obra)} · energía ${pct(r.composicion.energia)} · otros ${pct(r.composicion.otros)}`} />
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Costo de hacer el lote</h2>
          {puedeEditar && (
            <button
              type="button"
              onClick={() =>
                setOperacion((p) => [...p, { categoria: "otros", concepto: "", monto_gs: 0 }])
              }
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar línea
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Montos por lote completo, no por litro. Los insumos no van acá: salen de la receta.
        </p>

        {operacion.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sin costos de operación cargados. Mientras tanto, el costo del lote es sólo el de los
            insumos, que en una cervecería suele ser ~73 % del real.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2 pr-2">Categoría</th>
                  <th className="py-2 px-2">Concepto</th>
                  <th className="py-2 px-2 w-40 text-right">Monto por lote</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {operacion.map((l, i) => (
                  <tr key={l.id ?? i}>
                    <td className="py-2 pr-2">
                      <select
                        value={l.categoria}
                        disabled={!puedeEditar}
                        onChange={(e) => setLinea(i, { categoria: e.target.value as CategoriaOperacion })}
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      >
                        {CATEGORIAS_OPERACION.map((c) => (
                          <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        value={l.concepto}
                        disabled={!puedeEditar}
                        onChange={(e) => setLinea(i, { concepto: e.target.value })}
                        placeholder="Ej: Elaboración / cocimiento"
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <NumeroInput
                        value={l.monto_gs}
                        disabled={!puedeEditar}
                        onChange={(n) => setLinea(i, { monto_gs: n })}
                        className={inputCls}
                        aria-label="Monto por lote"
                      />
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => setOperacion((p) => p.filter((_, k) => k !== i))}
                          className="text-red-600 hover:text-red-700"
                          aria-label="Eliminar línea"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Parámetros de precio</h2>
        <p className="mb-3 text-xs text-slate-500">
          Los márgenes son sobre el precio, no sobre el costo: 40 % quiere decir que 40 de cada
          100 Gs facturados son margen. Son escenarios, no precios de mercado.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo etiqueta="Tarifa hora de envasado">
            <NumeroInput
              value={parametros.tarifa_mo_hora_gs}
              disabled={!puedeEditar}
              onChange={(n) => setParametros((p) => ({ ...p, tarifa_mo_hora_gs: n }))}
              className={inputCls}
              aria-label="Tarifa hora"
            />
          </Campo>
          <Campo etiqueta="Margen mayorista (%)">
            <NumeroInput
              value={Number((parametros.margen_mayorista_pct * 100).toFixed(2))}
              max={99}
              disabled={!puedeEditar}
              onChange={(n) => setParametros((p) => ({ ...p, margen_mayorista_pct: n / 100 }))}
              className={inputCls}
              aria-label="Margen mayorista"
            />
          </Campo>
          <Campo etiqueta="Margen venta directa (%)">
            <NumeroInput
              value={Number((parametros.margen_directo_pct * 100).toFixed(2))}
              max={99}
              disabled={!puedeEditar}
              onChange={(n) => setParametros((p) => ({ ...p, margen_directo_pct: n / 100 }))}
              className={inputCls}
              aria-label="Margen directo"
            />
          </Campo>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Envasado por formato</h2>
        <p className="mb-3 text-xs text-slate-500">
          El rendimiento es cuánto del lote sobrevive la línea de envasado en ese formato: 0,98
          quiere decir que se pierde 2 %. Esa pérdida la paga la unidad envasada.
        </p>
        {formatos.length === 0 ? (
          <p className="text-sm text-slate-500">
            Esta receta no tiene formatos de venta cargados. Se agregan desde la receta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2 pr-2">Formato</th>
                  <th className="py-2 px-2 w-24 text-right">Envase</th>
                  <th className="py-2 px-2 w-24 text-right">Tapa</th>
                  <th className="py-2 px-2 w-24 text-right">Etiqueta</th>
                  <th className="py-2 px-2 w-24 text-right">Caja</th>
                  <th className="py-2 px-2 w-24 text-right">Unid./h</th>
                  <th className="py-2 px-2 w-20 text-right">Operarios</th>
                  <th className="py-2 px-2 w-24 text-right">Rend.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {formatos.map((f, i) => (
                  <tr key={f.formato_id}>
                    <td className="py-2 pr-2 font-medium text-slate-700">{f.producto_nombre}</td>
                    {(["costo_envase", "costo_tapa", "costo_etiqueta", "costo_pack"] as const).map((k) => (
                      <td key={k} className="py-2 px-2">
                        <NumeroInput
                          value={f[k]}
                          disabled={!puedeEditar}
                          onChange={(n) => setFormato(i, { [k]: n } as Partial<FormatoEdit>)}
                          className={inputCls}
                          aria-label={k}
                        />
                      </td>
                    ))}
                    <td className="py-2 px-2">
                      <NumeroInput
                        value={f.velocidad_unid_hora ?? 0}
                        disabled={!puedeEditar}
                        onChange={(n) => setFormato(i, { velocidad_unid_hora: n > 0 ? n : null })}
                        className={inputCls}
                        aria-label="Unidades por hora"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <NumeroInput
                        value={f.operarios}
                        decimales={false}
                        disabled={!puedeEditar}
                        onChange={(n) => setFormato(i, { operarios: n })}
                        className={inputCls}
                        aria-label="Operarios"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <NumeroInput
                        value={f.rendimiento_packaging}
                        max={1}
                        fallback={1}
                        disabled={!puedeEditar}
                        onChange={(n) => setFormato(i, { rendimiento_packaging: n })}
                        className={inputCls}
                        aria-label="Rendimiento de envasado"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {r && r.formatos.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Costo y precio sugerido</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-2 pr-2">Formato</th>
                  <th className="py-2 px-2 text-right">Unidades</th>
                  <th className="py-2 px-2 text-right">Cerveza</th>
                  <th className="py-2 px-2 text-right">Packaging</th>
                  <th className="py-2 px-2 text-right">MO</th>
                  <th className="py-2 px-2 text-right">Costo/unid.</th>
                  <th className="py-2 px-2 text-right">Mayorista</th>
                  <th className="py-2 px-2 text-right">Directo</th>
                  <th className="py-2 pl-2 text-right">Precio hoy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.formatos.map((f) => (
                  <tr key={f.formato_id} className="tabular-nums">
                    <td className="py-2 pr-2 font-medium text-slate-700">{f.producto_nombre}</td>
                    <td className="py-2 px-2 text-right">{f.unidades.toLocaleString("es-PY")}</td>
                    <td className="py-2 px-2 text-right text-slate-500">{gs(f.costo_cerveza)}</td>
                    <td className="py-2 px-2 text-right text-slate-500">{gs(f.costo_packaging)}</td>
                    <td className="py-2 px-2 text-right text-slate-500">{gs(f.costo_mo_envasado)}</td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-800">{gs(f.costo_unitario)}</td>
                    <td className="py-2 px-2 text-right text-[#4FAEB2]">{gs(f.precio_mayorista)}</td>
                    <td className="py-2 px-2 text-right text-[#4FAEB2]">{gs(f.precio_directo)}</td>
                    <td className="py-2 pl-2 text-right">
                      {f.precio_venta_actual > 0 ? (
                        <>
                          {gs(f.precio_venta_actual)}
                          <span
                            className={`ml-1 text-xs ${
                              (f.margen_actual_pct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {f.margen_actual_pct == null ? "" : `${f.margen_actual_pct.toFixed(0)}%`}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">sin precio</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Las unidades son las que salen de un lote entero envasado todo en ese formato.
          </p>
        </section>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{valor}</div>
      {pie && <div className="mt-0.5 text-xs text-slate-500">{pie}</div>}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-600">{etiqueta}</label>
      {children}
    </div>
  );
}
