"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import ImportExcelButton from "@/components/ui/ImportExcelButton";
import { ChevronRight } from "lucide-react";
import { useIsAdmin } from "@/lib/auth/use-is-admin";
import { useDialogos } from "@/components/ui/Dialogos";

interface Ubicacion {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: string;
  parent_id: string | null;
  activo: boolean;
  /**
   * Lo que hay guardado acá. El stock no se lleva por depósito: cada producto
   * apunta a una ubicación principal, así que estos números son la suma de los
   * productos asignados a esta ubicación en la sucursal activa.
   */
  productos: number;
  unidades: number;
  valorizado: number;
  productos_sin_stock: number;
}

const fmtNum = (n: number) =>
  Number(n).toLocaleString("es-PY", { maximumFractionDigits: 2 });
const fmtGs = (n: number) => `Gs. ${Math.round(Number(n)).toLocaleString("es-PY")}`;

interface ProductoEnUbi {
  id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number;
  costo_promedio: number;
  unidad_medida: string | null;
}

const TIPOS = ["deposito","salon","pasillo","gondola","estante","zona","otro"] as const;

export default function UbicacionesPage() {
  const { isAdmin } = useIsAdmin();
  const { avisar, confirmar } = useDialogos();
  /**
   * Qué ubicación está abierta y qué hay adentro. Se pide al abrirla y no
   * antes: la lista puede tener cincuenta ubicaciones y nadie mira las
   * cincuenta.
   */
  const [abierta, setAbierta] = useState<string | null>(null);
  const [contenido, setContenido] = useState<Record<string, ProductoEnUbi[] | "cargando" | "error">>({});
  /** Fila que se está editando, con lo que se escribió hasta ahora. */
  const [editando, setEditando] = useState<{ id: string; nombre: string; codigo: string; tipo: string } | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [items, setItems] = useState<Ubicacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [tipo, setTipo] = useState<string>("deposito");
  const [parentId, setParentId] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/ubicaciones?todas=1", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.success) setItems(j.data.ubicaciones as Ubicacion[]);
      else setError(j?.error ?? "No se pudo cargar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/inventario/ubicaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nombre: nombre.trim(),
          codigo: codigo.trim() || null,
          tipo,
          parent_id: parentId || null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo crear.");
      } else {
        setNombre(""); setCodigo(""); setTipo("deposito"); setParentId("");
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreating(false);
    }
  }

  /**
   * Guardar el renombre. La ubicación es un rótulo: lo que cambia es cómo se
   * llama, de qué tipo es y su código. Mover productos de lugar se hace desde
   * el producto, no desde acá.
   */
  async function guardarEdicion() {
    if (!editando || guardandoEdicion) return;
    const nombre = editando.nombre.trim();
    if (nombre === "") {
      await avisar({ mensaje: "La ubicación necesita un nombre.", tono: "peligro" });
      return;
    }
    setGuardandoEdicion(true);
    try {
      const r = await fetch(`/api/inventario/ubicaciones/${editando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nombre, codigo: editando.codigo.trim() || null, tipo: editando.tipo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        await avisar({ mensaje: j?.error ?? "No se pudo guardar.", tono: "peligro" });
        return;
      }
      setEditando(null);
      load();
    } finally {
      setGuardandoEdicion(false);
    }
  }

  /**
   * Borrar. El servidor la deja borrar sólo si está vacía: sin productos
   * guardados ahí y sin ubicaciones adentro. Si tiene algo, dice qué.
   */
  async function borrar(u: Ubicacion) {
    const seguir = await confirmar({
      titulo: `Borrar "${u.nombre}"`,
      mensaje: "Sólo se puede borrar una ubicación vacía. Si tiene productos, movelos o desactivala.",
      confirmar: "Borrar",
      tono: "peligro",
    });
    if (!seguir) return;
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success) load();
    else await avisar({ mensaje: j?.error ?? "No se pudo borrar.", tono: "peligro" });
  }

  /** Abrir o cerrar una ubicación para ver qué hay guardado adentro. */
  async function alternarDetalle(u: Ubicacion) {
    if (abierta === u.id) {
      setAbierta(null);
      return;
    }
    setAbierta(u.id);
    // Lo ya traído no se vuelve a pedir: abrir y cerrar no castiga a la base.
    if (Array.isArray(contenido[u.id])) return;
    setContenido((prev) => ({ ...prev, [u.id]: "cargando" }));
    try {
      const r = await fetch(`/api/inventario/ubicaciones/${u.id}/productos`, {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setContenido((prev) => ({ ...prev, [u.id]: "error" }));
        return;
      }
      setContenido((prev) => ({ ...prev, [u.id]: (j.data?.productos ?? []) as ProductoEnUbi[] }));
    } catch {
      setContenido((prev) => ({ ...prev, [u.id]: "error" }));
    }
  }

  async function toggleActivo(u: Ubicacion) {
    const r = await fetch(`/api/inventario/ubicaciones/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ activo: !u.activo }),
    });
    const j = await r.json();
    if (r.ok && j?.success) load();
    else setError(j?.error ?? "No se pudo actualizar.");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Depósitos y ubicaciones</h1>
          <p className="text-gray-600">
            Donde se almacena físicamente cada producto: depósitos, salones, pasillos, góndolas, estantes, zonas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportExcelButton url="/api/inventario/ubicaciones/export" />
          <ImportExcelButton
            entidad="Ubicaciones"
            previewUrl="/api/inventario/ubicaciones/import/preview"
            commitUrl="/api/inventario/ubicaciones/import/commit"
            templateUrl="/api/inventario/ubicaciones/import/template"
            permiteCrearFaltantes
            visible={isAdmin}
            onCompleted={load}
          />
          <Link href="/inventario" className="text-sm text-sky-700 hover:text-sky-900 underline">
            ← Volver a Inventario
          </Link>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
          Nueva ubicación
        </p>
        <form onSubmit={handleCrear} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Depósito central"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: DEP-01"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-600 mb-1">Ubicación padre (opcional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— ninguna —</option>
              {items.filter((i) => i.activo).map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} ({i.tipo})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={creating || !nombre.trim()}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {creating ? "Creando..." : "Crear ubicación"}
            </button>
          </div>
        </form>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Todavía no cargaste ubicaciones.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-left px-4 py-2">Código</th>
                <th className="text-left px-4 py-2">Padre</th>
                <th className="text-right px-4 py-2">Productos</th>
                <th className="text-right px-4 py-2">Unidades</th>
                <th className="text-right px-4 py-2">Valorizado</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const parent = items.find((i) => i.id === u.parent_id);
                const detalle = contenido[u.id];
                const estaAbierta = abierta === u.id;
                return (
                  <Fragment key={u.id}>
                  <tr className={`border-t border-slate-100 ${estaAbierta ? "bg-slate-50" : ""}`}>
                    {editando?.id === u.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editando.nombre}
                            onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#4FAEB2]"
                            autoFocus
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={editando.tipo}
                            onChange={(e) => setEditando({ ...editando, tipo: e.target.value })}
                            className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#4FAEB2]"
                          >
                            {TIPOS.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editando.codigo}
                            onChange={(e) => setEditando({ ...editando, codigo: e.target.value })}
                            placeholder="—"
                            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#4FAEB2]"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-medium">
                          <button
                            type="button"
                            onClick={() => alternarDetalle(u)}
                            className="inline-flex items-center gap-1.5 text-left hover:text-[#2F6F72]"
                            title="Ver qué hay guardado acá"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${estaAbierta ? "rotate-90" : ""}`}
                              aria-hidden
                            />
                            {u.nombre}
                          </button>
                        </td>
                        <td className="px-4 py-2 text-gray-500">{u.tipo}</td>
                        <td className="px-4 py-2 text-gray-500">{u.codigo ?? "—"}</td>
                      </>
                    )}
                    <td className="px-4 py-2 text-gray-500">{parent?.nombre ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {u.productos > 0 ? fmtNum(u.productos) : "—"}
                      {u.productos_sin_stock > 0 && (
                        <span
                          className="ml-1.5 text-xs text-amber-700"
                          title={`${u.productos_sin_stock} sin stock`}
                        >
                          ({fmtNum(u.productos_sin_stock)} en 0)
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${u.unidades > 0 ? "text-slate-800" : "text-gray-400"}`}>
                      {fmtNum(u.unidades)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                      {u.valorizado > 0 ? fmtGs(u.valorizado) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {u.activo ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Activo</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editando?.id === u.id ? (
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={guardarEdicion}
                            disabled={guardandoEdicion}
                            className="text-xs font-semibold text-[#2F6F72] hover:underline disabled:opacity-50"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => setEditando(null)}
                            disabled={guardandoEdicion}
                            className="text-xs text-slate-500 hover:underline disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() =>
                              setEditando({ id: u.id, nombre: u.nombre, codigo: u.codigo ?? "", tipo: u.tipo })
                            }
                            className="text-xs text-slate-600 hover:text-slate-900 underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => toggleActivo(u)}
                            className="text-xs text-sky-700 hover:text-sky-900 underline"
                          >
                            {u.activo ? "Desactivar" : "Activar"}
                          </button>
                          <button
                            onClick={() => borrar(u)}
                            className="text-xs text-red-600 hover:text-red-800 underline"
                          >
                            Borrar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {estaAbierta && (
                    <tr className="border-t border-slate-100 bg-slate-50">
                      <td colSpan={9} className="px-4 py-3">
                        {detalle === "cargando" ? (
                          <p className="text-xs text-slate-400">Cargando…</p>
                        ) : detalle === "error" ? (
                          <p className="text-xs text-red-600">
                            No se pudo cargar lo que hay en esta ubicación.
                          </p>
                        ) : !detalle || detalle.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            No hay ningún producto guardado acá. Se asigna desde la ficha del
                            producto, en <span className="font-medium">Ubicación principal</span>.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {detalle.length} {detalle.length === 1 ? "producto" : "productos"} en {u.nombre}
                            </p>
                            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                              {detalle.map((p) => (
                                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                                  <Link
                                    href={`/inventario/${p.id}/editar`}
                                    className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-[#2F6F72] hover:underline"
                                  >
                                    {p.nombre}
                                  </Link>
                                  <span className="font-mono text-[11px] text-slate-400">{p.sku ?? "—"}</span>
                                  <span
                                    className={`w-28 text-right text-sm tabular-nums ${
                                      p.stock_actual > 0 ? "text-slate-700" : "text-amber-700"
                                    }`}
                                  >
                                    {fmtNum(p.stock_actual)}{" "}
                                    <span className="text-[11px] text-slate-400">
                                      {p.unidad_medida ?? ""}
                                    </span>
                                  </span>
                                  <span className="w-28 text-right text-xs tabular-nums text-slate-500">
                                    {p.stock_actual > 0 ? fmtGs(p.stock_actual * p.costo_promedio) : "—"}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs">
              <tr>
                <td className="px-4 py-2 font-semibold text-slate-700" colSpan={4}>
                  Total asignado a ubicaciones
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {fmtNum(items.reduce((a, u) => a + u.productos, 0))}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {fmtNum(items.reduce((a, u) => a + u.unidades, 0))}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {fmtGs(items.reduce((a, u) => a + u.valorizado, 0))}
                </td>
                <td className="px-4 py-2" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
        {!loading && items.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            El stock sale de la ubicación principal de cada producto. Un producto sin ubicación
            asignada no aparece en ningún depósito: se le asigna desde Inventario → editar producto.
          </p>
        )}
      </div>
    </div>
  );
}
