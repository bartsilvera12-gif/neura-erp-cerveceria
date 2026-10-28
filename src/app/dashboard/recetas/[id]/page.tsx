"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { AlertTriangle, ArrowLeft, Check, ChefHat, Factory, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { NEURA_CLIENT_SCHEMA } from "@/lib/supabase/schema";
import { formatUnidad } from "@/lib/unidades/format";
import { unidadesCompatibles, familiaUnidad } from "@/lib/unidades/convert";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { useRolErp } from "@/lib/auth/use-rol-erp";
import { puedeEditarRecetas } from "@/lib/roles/erp-role-access";

import NumeroInput from "@/components/ui/NumeroInput";
/** Reserva monocliente: receta pertenece al producto; nombre interno oculto (autogenera). */
const RECETA_SIMPLE = NEURA_CLIENT_SCHEMA === "cerveceriaerp";

type Receta = {
  id: string;
  producto_id: string;
  nombre: string | null;
  producto_nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  merma_proceso_pct: number;
  notas: string | null;
  activa: boolean;
};

const UNIDADES_RENDIMIENTO = ["UNIDAD", "PAQUETE", "PORCION", "FRASCO", "BOLSA", "DOCENA"];
const UNIDADES_INSUMO = ["G", "KG", "ML", "L", "UNIDAD"];
type Item = {
  id: string;
  insumo_producto_id: string;
  cantidad: number;
  unidad_medida: string | null;
  merma_pct: number;
  orden: number;
};
/** Un formato de venta ya costeado por `fn_receta_costeo`. */
type FormatoCosteo = {
  formato_id: string;
  producto_id: string;
  producto_nombre: string;
  capacidad: number;
  capacidad_unidad: string;
  unidad_incompatible: boolean;
  unidades_por_lote: number | null;
  costo_unitario: number | null;
  precio_venta: number;
  margen_objetivo_pct: number | null;
  precio_sugerido: number | null;
  margen_pct: number | null;
};
type Costeo = {
  costo_total: number;
  costo_unitario: number | null;
  precio_venta: number;
  margen_abs: number;
  margen_pct: number | null;
  unidades_posibles: number | null;
  merma_proceso_pct: number;
  rendimiento_unidad: string | null;
  rendimiento_envasable: number;
  costo_unitario_envasable: number | null;
  formatos: FormatoCosteo[];
  items: Array<{
    item_id: string;
    insumo_producto_id: string;
    insumo_nombre: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    costo_promedio: number;
    stock_actual: number;
    subcosto: number;
    unidades_aporte: number | null;
    unidad_incompatible?: boolean;
  }>;
};
type Producto = {
  id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  stock_actual: number;
  unidad_medida: string | null;
};

type InsumoReq = {
  producto_id: string;
  nombre: string;
  sku: string;
  unidad: string | null;
  requerido: number;
  stock_actual: number;
  costo_unitario: number;
  subcosto: number;
  faltante: number;
};
type ProduccionPreview = {
  receta_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad_fabricar: number;
  rendimiento_cantidad: number;
  unidad_rendimiento: string | null;
  insumos: InsumoReq[];
  insumos_incompatibles: string[];
  costo_total: number;
  costo_unitario: number;
  hay_faltantes: boolean;
};

function fmtGs(n: number | null | undefined) {
  if (n == null) return "—";
  return "Gs. " + Number(n).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

export default function EditarRecetaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  // Editar el recetario: solo admin/supervisor. FABRICAR: todos los roles.
  // Los guards reales viven en /api/recetas/* (requireEdicionRecetas); acá solo
  // ocultamos los controles de edición para que el operador no choque con un 403.
  const { rol, loaded: rolLoaded } = useRolErp();
  const puedeEditar = puedeEditarRecetas(rol);

  const [receta, setReceta] = useState<Receta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [costeo, setCosteo] = useState<Costeo | null>(null);
  const [insumos, setInsumos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingHeader, setSavingHeader] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // form add item
  const [newInsumoId, setNewInsumoId] = useState("");
  const [newCantidad, setNewCantidad] = useState<number>(1);
  const [newUnidad, setNewUnidad] = useState("");
  const [newMerma, setNewMerma] = useState<number>(0);
  const [addingItem, setAddingItem] = useState(false);

  // Formatos de venta: productos vendibles a los que se reparte el lote.
  const [vendibles, setVendibles] = useState<Producto[]>([]);
  const [fmtProductoId, setFmtProductoId] = useState("");
  const [fmtCapacidad, setFmtCapacidad] = useState<number>(1);
  const [fmtUnidad, setFmtUnidad] = useState("L");
  const [fmtBusy, setFmtBusy] = useState<string | null>(null);
  const [fmtError, setFmtError] = useState<string | null>(null);

  // Fabricación (producción)
  const [fabOpen, setFabOpen] = useState(false);
  const [fabCantidad, setFabCantidad] = useState<number>(1);
  const [fabObs, setFabObs] = useState("");
  const [fabPreview, setFabPreview] = useState<ProduccionPreview | null>(null);
  const [fabLoadingPreview, setFabLoadingPreview] = useState(false);
  const [fabSubmitting, setFabSubmitting] = useState(false);
  const [fabError, setFabError] = useState<string | null>(null);
  const [fabOk, setFabOk] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [recRes, prodRes, vendRes] = await Promise.all([
      fetchWithSupabaseSession(`/api/recetas/${id}`, { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/recetas/productos?filtro=insumos`, { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/recetas/productos?filtro=vendibles`, { cache: "no-store" }),
    ]);
    const recBody = await recRes.json();
    const prodBody = await prodRes.json();
    if (!recRes.ok || recBody?.success === false) {
      setError(recBody?.error ?? "Error al cargar receta");
      return;
    }
    setReceta(recBody.data.receta);
    setItems(recBody.data.items ?? []);
    setCosteo(recBody.data.costeo ?? null);
    if (prodRes.ok && prodBody?.success) {
      setInsumos((prodBody.data.productos ?? []) as Producto[]);
    }
    if (vendRes.ok) {
      const vendBody = await vendRes.json();
      if (vendBody?.success) setVendibles((vendBody.data.productos ?? []) as Producto[]);
    }
  }, [id]);

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

  /**
   * Unidad en la que se controla cada insumo en el inventario.
   *
   * `costo_promedio` y `stock_actual` vienen del producto, así que están en SU
   * unidad (KG), no en la unidad de consumo de la receta (G). La tabla los
   * etiquetaba con la unidad del ítem y mostraba "Gs. 20.000/G" para una harina
   * que cuesta 20.000/KG: con ese cartel es imposible darse cuenta de si el
   * costo se cargó por kilo o por gramo, que es justo lo que hace que el
   * subcosto salga mil veces más grande.
   */
  const unidadDeInsumo = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of insumos) m.set(p.id, p.unidad_medida ?? null);
    return m;
  }, [insumos]);

  const insumosDisponibles = useMemo(() => {
    const usados = new Set(items.map((i) => i.insumo_producto_id));
    return insumos.filter((p) => !usados.has(p.id));
  }, [insumos, items]);

  useEffect(() => {
    if (insumosDisponibles.length > 0 && !newInsumoId) {
      setNewInsumoId(insumosDisponibles[0].id);
      setNewUnidad(insumosDisponibles[0].unidad_medida ?? "");
    }
  }, [insumosDisponibles, newInsumoId]);

  async function saveHeader() {
    if (!receta || savingHeader) return;
    setError(null);
    setSavedOk(false);
    setSavingHeader(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/recetas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: receta.nombre,
          rendimiento_cantidad: receta.rendimiento_cantidad,
          rendimiento_unidad: receta.rendimiento_unidad,
          merma_proceso_pct: receta.merma_proceso_pct ?? 0,
          notas: receta.notas,
          activa: receta.activa,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "Error al guardar");
        return;
      }
      await refresh();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } finally {
      setSavingHeader(false);
    }
  }

  async function addItem() {
    if (addingItem) return;
    if (!newInsumoId) return setError("Elegí la materia prima que querés agregar.");
    if (!(newCantidad > 0)) return setError("Indicá la cantidad usada (mayor a 0).");
    setError(null);
    // Validar compatibilidad de unidad con el insumo (no inventamos densidades).
    const insumoSel = insumosDisponibles.find((x) => x.id === newInsumoId);
    const unidadInsumo = insumoSel?.unidad_medida ?? null;
    if (newUnidad.trim() && unidadInsumo && !unidadesCompatibles(newUnidad, unidadInsumo)) {
      const fam = familiaUnidad(unidadInsumo);
      const sugerencia = fam === "masa" ? "Grs o Kg" : fam === "volumen" ? "Ml o Lts" : "Unidad";
      setError(`La unidad seleccionada no es compatible con la unidad del insumo. Este insumo se controla en ${formatUnidad(unidadInsumo)}; usá ${sugerencia}.`);
      return;
    }
    setAddingItem(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/recetas/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insumo_producto_id: newInsumoId,
          cantidad: Number(newCantidad),
          unidad_medida: newUnidad.trim() || null,
          merma_pct: Number(newMerma) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "Error al agregar item");
        return;
      }
      setNewInsumoId("");
      setNewCantidad(1);
      setNewUnidad("");
      setNewMerma(0);
      await refresh();
    } finally {
      setAddingItem(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!confirm("¿Eliminar este insumo de la receta?")) return;
    const res = await fetchWithSupabaseSession(`/api/recetas/${id}/items/${itemId}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "Error al eliminar");
      return;
    }
    await refresh();
  }

  async function deleteReceta() {
    if (!confirm("¿Eliminar receta completa? Esta acción no se puede deshacer.")) return;
    const res = await fetchWithSupabaseSession(`/api/recetas/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "Error al eliminar");
      return;
    }
    router.push("/dashboard/recetas");
  }

  // Preview de fabricación: recalcula insumos requeridos/faltantes/costo al abrir o cambiar cantidad.
  useEffect(() => {
    if (!fabOpen || !(fabCantidad > 0)) {
      setFabPreview(null);
      return;
    }
    let cancel = false;
    setFabLoadingPreview(true);
    setFabError(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithSupabaseSession(`/api/producciones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receta_id: id, cantidad: Number(fabCantidad), preview: true }),
        });
        const body = await res.json();
        if (cancel) return;
        if (!res.ok || body?.success === false) {
          setFabError(body?.error ?? "No se pudo calcular la fabricación.");
          setFabPreview(null);
          return;
        }
        setFabPreview(body.data.preview as ProduccionPreview);
      } catch {
        if (!cancel) setFabError("Error de red al calcular la fabricación.");
      } finally {
        if (!cancel) setFabLoadingPreview(false);
      }
    }, 300);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [fabOpen, fabCantidad, id]);

  function openFabricar() {
    setFabCantidad(receta?.rendimiento_cantidad && receta.rendimiento_cantidad > 0 ? receta.rendimiento_cantidad : 1);
    setFabObs("");
    setFabError(null);
    setFabOk(null);
    setFabPreview(null);
    setFabOpen(true);
  }

  // Entrada directa a fabricar desde el listado (`?fabricar=1`): abre el modal
  // apenas la receta está cargada, sin pasar por la pantalla de edición.
  const [fabAutoAbierto, setFabAutoAbierto] = useState(false);
  useEffect(() => {
    if (fabAutoAbierto || !receta) return;
    let quiereFabricar = false;
    try {
      quiereFabricar = new URLSearchParams(window.location.search).get("fabricar") === "1";
    } catch {
      quiereFabricar = false;
    }
    if (!quiereFabricar) return;
    setFabAutoAbierto(true);
    openFabricar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receta, fabAutoAbierto]);

  async function submitFabricar(permitirSinStock: boolean) {
    if (fabSubmitting || !(fabCantidad > 0)) return;
    setFabSubmitting(true);
    setFabError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/producciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receta_id: id,
          cantidad: Number(fabCantidad),
          observaciones: fabObs.trim() || null,
          permitir_sin_stock: permitirSinStock,
        }),
      });
      const body = await res.json();
      if (res.status === 409 && Array.isArray(body?.faltantes)) {
        // Falta materia prima → reflejar en el preview para mostrar faltantes y habilitar "Fabricar igual".
        setFabError("Falta materia prima para esta cantidad. Revisá los faltantes abajo.");
        setFabPreview((prev) =>
          prev ? { ...prev, hay_faltantes: true } : prev
        );
        return;
      }
      if (!res.ok || body?.success === false) {
        setFabError(body?.error ?? "No se pudo registrar la fabricación.");
        return;
      }
      const prod = body.data.produccion as { cantidad_fabricada: number; producto_nombre: string };
      setFabOpen(false);
      setFabOk(`Se fabricaron ${fmtNum(prod.cantidad_fabricada)} de ${prod.producto_nombre}. Stock actualizado.`);
      setTimeout(() => setFabOk(null), 4000);
      await refresh();
    } catch {
      setFabError("Error de red al registrar la fabricación.");
    } finally {
      setFabSubmitting(false);
    }
  }

  /**
   * Toda acción sobre formatos recarga el costeo: el precio sugerido depende
   * del costo, del margen y de la merma, y mostrar un número viejo al lado de
   * uno nuevo es peor que esperar el refresco.
   */
  async function formatoRequest(
    url: string,
    init: RequestInit,
    key: string,
    errorMsg: string
  ) {
    if (fmtBusy) return;
    setFmtError(null);
    setFmtBusy(key);
    try {
      const res = await fetchWithSupabaseSession(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        setFmtError(body?.error ?? errorMsg);
        return;
      }
      await refresh();
    } catch {
      setFmtError("Error de red.");
    } finally {
      setFmtBusy(null);
    }
  }

  const formatos = costeo?.formatos ?? [];
  const vendiblesDisponibles = vendibles.filter(
    (p) => !formatos.some((f) => f.producto_id === p.id)
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (!receta) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error ?? "Receta no encontrada"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href="/dashboard/recetas"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ChefHat className="h-7 w-7 text-[#4FAEB2]" />
          <h1 className="text-2xl font-semibold">
            {receta.nombre?.trim() || (receta.producto_nombre ? `Receta: ${receta.producto_nombre}` : "Receta")}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openFabricar}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91]"
          >
            <Factory className="h-4 w-4" /> Fabricar
          </button>
          {puedeEditar && (
            <button
              onClick={deleteReceta}
              className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" /> Eliminar receta
            </button>
          )}
        </div>
      </div>

      {fabOk && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700 mb-4">
          <Check className="mr-1 inline h-4 w-4" aria-hidden />{fabOk}
        </div>
      )}

      {/* Costeo summary */}
      {costeo && (
        <div className="grid grid-cols-2 gap-3 mb-6 md:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Costo total receta</div>
            <div className="text-lg font-semibold text-gray-900">{fmtGs(costeo.costo_total)}</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Costo unitario</div>
            <div className="text-lg font-semibold text-gray-900">{fmtGs(costeo.costo_unitario)}</div>
            <div className="text-xs text-gray-500">costo total / rendimiento</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Costo real por unidad</div>
            <div className="text-lg font-semibold text-gray-900">
              {fmtGs(costeo.costo_unitario_envasable)}
            </div>
            <div className="text-xs text-gray-500">
              {(costeo.merma_proceso_pct ?? 0) > 0
                ? `sobre ${fmtNum(costeo.rendimiento_envasable)} ${formatUnidad(costeo.rendimiento_unidad ?? "") || ""} envasables (merma ${Number((costeo.merma_proceso_pct * 100).toFixed(1))}%)`
                : "sin merma de proceso cargada"}
            </div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Margen</div>
            <div className={`text-lg font-semibold ${(costeo.margen_pct ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
              {costeo.margen_pct == null ? "—" : `${costeo.margen_pct}%`}
            </div>
            <div className="text-xs text-gray-500">{fmtGs(costeo.margen_abs)} / unidad</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Unidades posibles</div>
            <div className="text-lg font-semibold text-gray-900">
              {costeo.unidades_posibles == null
                ? "—"
                : Math.floor(costeo.unidades_posibles * (receta.rendimiento_cantidad || 1)).toLocaleString("es-PY")}
              {receta.rendimiento_unidad ? <span className="ml-1 text-xs font-normal text-gray-400">{formatUnidad(receta.rendimiento_unidad)}</span> : null}
            </div>
            <div className="text-xs text-gray-500">
              {costeo.unidades_posibles == null
                ? "según stock de insumos"
                : `${costeo.unidades_posibles} lote(s) × ${receta.rendimiento_cantidad} — según stock de materia prima`}
            </div>
          </div>
        </div>
      )}


      {/* ── FORMATOS DE VENTA Y PRECIO ──────────────────────────────────── */}
      {costeo && (
        <div className="mb-6 rounded-md border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Formatos de venta y precio</h2>
              <p className="text-[11px] text-gray-500">
                El lote se reparte entre estos productos. El precio sugerido sale del costo
                real por unidad y del margen objetivo de cada uno.
              </p>
            </div>
          </div>

          {fmtError && (
            <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
              {fmtError}
            </div>
          )}

          {formatos.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              Sin formatos cargados. Agregá uno abajo para ver el precio sugerido.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Formato</th>
                    <th className="px-4 py-2 font-medium">Capacidad</th>
                    <th className="px-4 py-2 text-right font-medium">Por lote</th>
                    <th className="px-4 py-2 text-right font-medium">Costo</th>
                    <th className="px-4 py-2 text-right font-medium">Margen obj.</th>
                    <th className="px-4 py-2 text-right font-medium">Precio sugerido</th>
                    <th className="px-4 py-2 text-right font-medium">Precio actual</th>
                    <th className="px-4 py-2 text-right font-medium">Margen real</th>
                    {puedeEditar && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {formatos.map((f) => {
                    const ocupado = fmtBusy === f.formato_id;
                    return (
                      <tr key={f.formato_id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 font-medium text-gray-800">{f.producto_nombre}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {fmtNum(f.capacidad)} {formatUnidad(f.capacidad_unidad)}
                          {f.unidad_incompatible && (
                            <span
                              className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                              title="La capacidad no se puede convertir a la unidad de rendimiento de la receta."
                            >
                              <AlertTriangle className="mr-1 h-2.5 w-2.5" aria-hidden />
                              unidad incompatible
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {f.unidades_por_lote == null ? "—" : fmtNum(f.unidades_por_lote)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtGs(f.costo_unitario)}</td>
                        <td className="px-4 py-2 text-right">
                          {puedeEditar ? (
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="99"
                              disabled={ocupado}
                              defaultValue={
                                f.margen_objetivo_pct == null
                                  ? ""
                                  : Number((f.margen_objetivo_pct * 100).toFixed(2))
                              }
                              placeholder="—"
                              onBlur={(e) => {
                                const txt = e.target.value.trim();
                                const pct = txt === "" ? null : Number(txt);
                                if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct >= 100)) return;
                                const nuevo = pct === null ? null : pct / 100;
                                if (nuevo === (f.margen_objetivo_pct ?? null)) return;
                                void formatoRequest(
                                  `/api/recetas/${id}/formatos/${f.formato_id}`,
                                  {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      producto_id: f.producto_id,
                                      margen_objetivo_pct: nuevo,
                                    }),
                                  },
                                  f.formato_id,
                                  "No se pudo guardar el margen."
                                );
                              }}
                              className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                            />
                          ) : f.margen_objetivo_pct == null ? (
                            "—"
                          ) : (
                            `${Number((f.margen_objetivo_pct * 100).toFixed(1))}%`
                          )}
                          <span className="ml-1 text-[11px] text-gray-400">%</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                          {f.precio_sugerido == null ? (
                            <span className="text-xs font-normal text-gray-400">sin margen objetivo</span>
                          ) : (
                            fmtGs(f.precio_sugerido)
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {fmtGs(f.precio_venta)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${
                            f.margen_pct == null
                              ? "text-gray-400"
                              : f.margen_pct >= 0
                                ? "text-green-700"
                                : "text-red-700"
                          }`}
                        >
                          {f.margen_pct == null ? "—" : `${f.margen_pct}%`}
                        </td>
                        {puedeEditar && (
                          <td className="whitespace-nowrap px-4 py-2 text-right">
                            {f.precio_sugerido != null &&
                              Math.round(f.precio_sugerido) !== Math.round(f.precio_venta) && (
                                <button
                                  type="button"
                                  disabled={ocupado}
                                  onClick={() =>
                                    void formatoRequest(
                                      `/api/recetas/${id}/formatos/${f.formato_id}`,
                                      {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          producto_id: f.producto_id,
                                          precio_venta: Math.round(f.precio_sugerido ?? 0),
                                        }),
                                      },
                                      f.formato_id,
                                      "No se pudo aplicar el precio."
                                    )
                                  }
                                  className="mr-2 rounded border border-[#4FAEB2] px-2 py-1 text-xs font-medium text-[#2F6F72] hover:bg-[#4FAEB2]/10 disabled:opacity-50"
                                >
                                  Aplicar
                                </button>
                              )}
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() =>
                                void formatoRequest(
                                  `/api/recetas/${id}/formatos/${f.formato_id}`,
                                  { method: "DELETE" },
                                  f.formato_id,
                                  "No se pudo quitar el formato."
                                )
                              }
                              className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Quitar
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

          {puedeEditar && (
            <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-4 py-3">
              <div className="min-w-[14rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">Producto vendible</label>
                <select
                  value={fmtProductoId}
                  onChange={(e) => setFmtProductoId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Elegí —</option>
                  {vendiblesDisponibles.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-gray-600">Capacidad</label>
                <NumeroInput
                  value={fmtCapacidad}
                  onChange={setFmtCapacidad}
                  min={0}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  aria-label="Capacidad del formato"
                />
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs font-medium text-gray-600">Unidad</label>
                <select
                  value={fmtUnidad}
                  onChange={(e) => setFmtUnidad(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {["ML", "L", "UNIDAD"].map((u) => (
                    <option key={u} value={u}>{formatUnidad(u)}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={!fmtProductoId || fmtCapacidad <= 0 || fmtBusy !== null}
                onClick={() =>
                  void formatoRequest(
                    `/api/recetas/${id}/formatos`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        producto_id: fmtProductoId,
                        capacidad: fmtCapacidad,
                        capacidad_unidad: fmtUnidad,
                        orden: formatos.length + 1,
                      }),
                    },
                    "nuevo",
                    "No se pudo agregar el formato."
                  ).then(() => setFmtProductoId(""))
                }
                className="rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {fmtBusy === "nuevo" ? "Agregando…" : "Agregar formato"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Header form */}
      <div className="bg-white p-5 rounded-md border border-gray-200 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Datos de la receta</h2>
        <p className="text-xs text-gray-500 mb-3">
          El <b>rendimiento</b> es cuántas unidades produce esta receta con los insumos indicados.
          Ej: 1.500 G de avena + 300 G de miel para producir <b>10 paquetes</b>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {RECETA_SIMPLE ? (
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Receta de</label>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">
                {receta.producto_nombre ?? "—"}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">La receta pertenece a este producto del menú.</p>
            </div>
          ) : (
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la receta</label>
            <input
              type="text"
              value={receta.nombre ?? ""}
              onChange={(e) => setReceta({ ...receta, nombre: e.target.value })}
              placeholder={receta.producto_nombre ? `Ej: Receta de ${receta.producto_nombre}` : "Ej: Granola Orgánica 250g"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Si lo dejás vacío, se mostrará el nombre del producto: <b>{receta.producto_nombre ?? "—"}</b>.
            </p>
          </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rendimiento (cantidad)</label>
            <NumeroInput
              value={receta.rendimiento_cantidad}
              onChange={(n) => setReceta({ ...receta, rendimiento_cantidad: n })}
              min={0}
              fallback={1}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              aria-label="Rendimiento (cantidad)"
            />
            <p className="mt-1 text-[11px] text-gray-400">¿Cuántas unidades produce?</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unidad de rendimiento</label>
            <select
              value={receta.rendimiento_unidad ?? ""}
              onChange={(e) => setReceta({ ...receta, rendimiento_unidad: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">— Elegí —</option>
              {UNIDADES_RENDIMIENTO.map((u) => <option key={u} value={u}>{formatUnidad(u)}</option>)}
              {receta.rendimiento_unidad && !UNIDADES_RENDIMIENTO.includes(receta.rendimiento_unidad) && (
                <option value={receta.rendimiento_unidad}>{formatUnidad(receta.rendimiento_unidad)}</option>
              )}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">paquetes, unidades, frascos…</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Merma de proceso (%)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="99"
              value={Number((((receta.merma_proceso_pct ?? 0) * 100).toFixed(2)))}
              onChange={(e) => {
                const pct = Number(e.target.value);
                const seguro = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 99) : 0;
                setReceta({ ...receta, merma_proceso_pct: seguro / 100 });
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Lo que se pierde entre el rendimiento teórico y lo que realmente se envasa.
            </p>
          </div>
          <div className="flex items-end pb-6">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={receta.activa}
                onChange={(e) => setReceta({ ...receta, activa: e.target.checked })}
                className="rounded"
              />
              Activa
            </label>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
            <textarea
              value={receta.notas ?? ""}
              onChange={(e) => setReceta({ ...receta, notas: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-gray-400">
          Los insumos se cargan abajo y se guardan al agregarlos. Usá <b>Guardar receta</b> (al final) para guardar estos datos.
        </p>
      </div>

      {/* Items */}
      <div className="bg-white p-5 rounded-md border border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Insumos (materia prima)</h2>
        <p className="text-xs text-gray-500 mb-3">
          Cargá cada materia prima con la <b>cantidad usada</b> para todo el rendimiento, su <b>unidad de consumo</b>
          y la <b>merma %</b> (desperdicio). La merma aumenta el consumo real del insumo. El costo se calcula con el
          costo promedio de cada insumo; las <b>unidades posibles</b> salen del stock disponible de materia prima.
        </p>
        <p className="mb-3 text-xs text-gray-500">
          El <b>costo/u. insumo</b> y el <b>stock</b> están en la unidad con la que se controla el insumo en
          Inventario, que puede no ser la unidad de consumo de la receta. Si el subcosto sale mil veces más
          grande de lo esperado, casi siempre es que el costo del insumo se cargó por kilo en un producto que
          se controla en gramos (o al revés): se corrige en Inventario, no acá.
        </p>

        {items.length === 0 && (
          <div className="text-sm text-gray-500 mb-3">
            Sin insumos todavía. Agregá insumos del inventario para calcular costo y disponibilidad.
          </div>
        )}

        {items.length > 0 && costeo && (
          /* Wrapper overflow-x-auto + min-w-[840px] activa scroll horizontal
              real en mobile. Columnas secundarias (Merma, Costo unit., Stock,
              Unid. posibles) se ocultan progresivamente para no aplastar todo. */
          <div className="overflow-x-auto -mx-px sm:mx-0">
          <table className="w-full min-w-[840px] sm:min-w-0 text-sm mb-4">
            <thead className="text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="py-2">Insumo</th>
                <th className="py-2">Cantidad usada</th>
                <th className="py-2 hidden md:table-cell">U. consumo</th>
                <th className="py-2 hidden lg:table-cell">Merma</th>
                <th className="py-2 hidden md:table-cell">Costo/u. insumo</th>
                <th className="py-2 hidden xl:table-cell">Consumo real</th>
                <th className="py-2">Subcosto</th>
                <th className="py-2 hidden lg:table-cell">Stock</th>
                <th className="py-2 hidden lg:table-cell">Alcanza para</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {costeo.items.map((row) => (
                <tr key={row.item_id}>
                  <td className="py-2 font-medium text-gray-800">{row.insumo_nombre}</td>
                  <td className="py-2 tabular-nums">{Number(row.cantidad).toLocaleString("es-PY")} <span className="text-xs text-gray-400">{formatUnidad(row.unidad_medida)}</span></td>
                  <td className="py-2 text-gray-600 hidden md:table-cell">{formatUnidad(row.unidad_medida) || "—"}</td>
                  <td className="py-2 text-gray-600 hidden lg:table-cell">{(row.merma_pct * 100).toFixed(0)}%</td>
                  <td className="py-2 hidden md:table-cell">
                    {fmtGs(row.costo_promedio)}
                    <span className="text-[10px] text-gray-400">
                      /{formatUnidad(unidadDeInsumo.get(row.insumo_producto_id) ?? "") || "u"}
                    </span>
                  </td>
                  {/* Cuánto insumo se consume de verdad, en la unidad del insumo:
                      es el número que multiplica al costo para dar el subcosto. */}
                  <td className="py-2 hidden xl:table-cell tabular-nums text-gray-600">
                    {row.unidad_incompatible || row.costo_promedio <= 0
                      ? "—"
                      : `${(row.subcosto / row.costo_promedio).toLocaleString("es-PY", { maximumFractionDigits: 4 })} ${formatUnidad(unidadDeInsumo.get(row.insumo_producto_id) ?? "") || ""}`.trim()}
                  </td>
                  <td className="py-2 tabular-nums">
                    {row.unidad_incompatible
                      ? <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium px-2 py-0.5" title="La unidad del ítem no es compatible con la del insumo; no se cuenta en el costo."><AlertTriangle className="mr-1 h-2.5 w-2.5" aria-hidden />Unidad incompatible</span>
                      : fmtGs(row.subcosto)}
                  </td>
                  <td className="py-2 text-gray-600 hidden lg:table-cell tabular-nums">
                    {Number(row.stock_actual).toLocaleString("es-PY")}{" "}
                    <span className="text-xs text-gray-400">
                      {formatUnidad(unidadDeInsumo.get(row.insumo_producto_id) ?? "")}
                    </span>
                  </td>
                  <td className="py-2 hidden lg:table-cell tabular-nums">
                    {row.unidades_aporte == null ? "—" : `${Math.floor(row.unidades_aporte * (receta.rendimiento_cantidad || 1)).toLocaleString("es-PY")} u.`}
                  </td>
                  <td className="py-2 text-right">
                    {puedeEditar && (
                      <button
                        onClick={() => removeItem(row.item_id)}
                        className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                        aria-label="Eliminar"
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

        {/* Add item — solo admin/supervisor */}
        {!puedeEditar && rolLoaded && (
          <div className="border-t border-gray-200 pt-4 text-xs text-slate-500">
            Solo un administrador o supervisor puede modificar el recetario. Podés{" "}
            <b>Fabricar</b> desde esta receta.
          </div>
        )}
        {puedeEditar && (
        <div className="border-t border-gray-200 pt-4">
          <div className="text-xs font-medium text-gray-600 mb-2">Agregar insumo</div>
          {insumosDisponibles.length === 0 ? (
            <div className="text-sm text-gray-500">
              No hay más insumos disponibles. Marcá productos como insumo (<code>es_insumo=true</code>) desde Inventario.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <div className="md:col-span-2">
                <label className="block text-[11px] text-gray-500 mb-1">Materia prima</label>
                <SearchableSelect
                  value={newInsumoId || null}
                  onChange={(id) => {
                    setNewInsumoId(id);
                    const p = insumosDisponibles.find((x) => x.id === id);
                    if (p) setNewUnidad(p.unidad_medida ?? "");
                  }}
                  options={insumosDisponibles.map((p) => ({
                    id: p.id,
                    label: p.nombre,
                    hint: (p as { sku?: string | null }).sku ?? null,
                  }))}
                  placeholder="Buscar y elegir insumo…"
                  emptyText="Sin insumos que coincidan"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Cantidad usada</label>
                <NumeroInput
                  value={newCantidad}
                  onChange={setNewCantidad}
                  min={0}
                  fallback={1}
                  placeholder="Ej: 1500"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  aria-label="Cantidad usada del insumo"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Unidad de consumo</label>
                <select
                  value={newUnidad}
                  onChange={(e) => setNewUnidad(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">— Elegí —</option>
                  {UNIDADES_INSUMO.map((u) => <option key={u} value={u}>{formatUnidad(u)}</option>)}
                  {newUnidad && !UNIDADES_INSUMO.includes(newUnidad) && <option value={newUnidad}>{formatUnidad(newUnidad)}</option>}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Merma %</label>
                <NumeroInput
                  value={Math.round(newMerma * 100)}
                  onChange={(n) => setNewMerma(Math.min(0.99, Math.max(0, n / 100)))}
                  min={0}
                  max={99}
                  decimales={false}
                  placeholder="Ej: 5"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  aria-label="Merma del insumo en porcentaje"
                />
              </div>
              <p className="md:col-span-5 -mt-1 text-[11px] text-gray-400">
                Ej: 1.500 Grs de avena para producir 10 paquetes. La merma % (desperdicio) aumenta el consumo real del insumo.
                {(() => {
                  const ins = insumosDisponibles.find((x) => x.id === newInsumoId);
                  return ins?.unidad_medida ? <> Este insumo se controla en <b>{formatUnidad(ins.unidad_medida)}</b>.</> : null;
                })()}
              </p>
              <p className="md:col-span-5 -mt-2 text-[11px] text-sky-600">
                El sistema convierte automáticamente Kg↔Grs y Lts↔Ml para calcular el costo y descontar stock.
              </p>
              <button
                onClick={addItem}
                disabled={addingItem || !newInsumoId || newCantidad <= 0}
                className="md:col-span-5 inline-flex items-center justify-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {addingItem ? "Agregando…" : "Agregar insumo"}
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Barra de acción final */}
      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        {savedOk && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 sm:mr-auto"><Check className="h-4 w-4" aria-hidden />Receta guardada</span>}
        <Link
          href="/dashboard/recetas"
          className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Volver a recetas
        </Link>
        {puedeEditar && (
        <button
          onClick={saveHeader}
          disabled={savingHeader}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {savingHeader ? "Guardando…" : "Guardar receta"}
        </button>
        )}
      </div>

      {/* Modal Fabricar */}
      {fabOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <Factory className="h-5 w-5 text-[#4FAEB2]" />
                <h3 className="text-base font-semibold text-gray-900">
                  Fabricar {receta.producto_nombre ?? "producto"}
                </h3>
              </div>
              <button
                onClick={() => setFabOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cantidad a fabricar</label>
                  <NumeroInput
                    value={fabCantidad}
                    onChange={setFabCantidad}
                    min={0}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    aria-label="Cantidad a fabricar"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Unidades del producto terminado a producir.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones (opcional)</label>
                  <input
                    type="text"
                    value={fabObs}
                    onChange={(e) => setFabObs(e.target.value)}
                    placeholder="Ej: lote mañana"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {fabError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {fabError}
                </div>
              )}

              {fabLoadingPreview && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculando insumos…
                </div>
              )}

              {fabPreview && !fabLoadingPreview && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
                      <div className="text-[11px] text-gray-500 uppercase">Costo total</div>
                      <div className="text-base font-semibold text-gray-900">{fmtGs(fabPreview.costo_total)}</div>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
                      <div className="text-[11px] text-gray-500 uppercase">Costo unitario</div>
                      <div className="text-base font-semibold text-gray-900">{fmtGs(fabPreview.costo_unitario)}</div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="py-2">Materia prima</th>
                          <th className="py-2 text-right">Requerido</th>
                          <th className="py-2 text-right">Stock</th>
                          <th className="py-2 text-right">Falta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {fabPreview.insumos.map((ins) => (
                          <tr key={ins.producto_id} className={ins.faltante > 0 ? "bg-amber-50" : ""}>
                            <td className="py-2 font-medium text-gray-800">{ins.nombre}</td>
                            <td className="py-2 text-right tabular-nums">
                              {fmtNum(ins.requerido)} <span className="text-xs text-gray-400">{formatUnidad(ins.unidad)}</span>
                            </td>
                            <td className="py-2 text-right tabular-nums text-gray-600">
                              {fmtNum(ins.stock_actual)} <span className="text-xs text-gray-400">{formatUnidad(ins.unidad)}</span>
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {ins.faltante > 0 ? (
                                <span className="text-amber-700 font-medium">{fmtNum(ins.faltante)}</span>
                              ) : (
                                <Check className="inline h-4 w-4 text-emerald-600" aria-hidden />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {fabPreview.insumos_incompatibles.length > 0 && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />Insumos con unidad incompatible (no se descuentan):{" "}
                      {fabPreview.insumos_incompatibles.join(", ")}. Revisá las unidades en la receta.
                    </div>
                  )}

                  {fabPreview.hay_faltantes && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                      No hay suficiente materia prima para fabricar esta cantidad. Podés fabricar igual
                      (el stock de los insumos faltantes quedará en 0) o reducir la cantidad.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-gray-200 px-5 py-4 sticky bottom-0 bg-white">
              <button
                onClick={() => setFabOpen(false)}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              {fabPreview?.hay_faltantes ? (
                <button
                  onClick={() => submitFabricar(true)}
                  disabled={fabSubmitting || !(fabCantidad > 0)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  <Factory className="h-4 w-4" /> {fabSubmitting ? "Fabricando…" : "Fabricar sin stock"}
                </button>
              ) : (
                <button
                  onClick={() => submitFabricar(false)}
                  disabled={fabSubmitting || fabLoadingPreview || !fabPreview || !(fabCantidad > 0)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50"
                >
                  <Factory className="h-4 w-4" /> {fabSubmitting ? "Fabricando…" : "Confirmar fabricación"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
