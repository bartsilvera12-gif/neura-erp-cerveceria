"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Beer, Check, Search, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * La carta, para pedir tocando.
 *
 * POR QUE NO ES UN BUSCADOR
 * En el salón nadie tipea: el mozo mira la carta y toca. Antes había que
 * escribir dos letras para que apareciera algo, y quien no se acuerda del
 * nombre exacto de un menú no encuentra nada. Acá entra todo cargado de una
 * vez, con pestañas por categoría, y el buscador filtra sobre lo que ya está
 * en pantalla — sin una llamada por tecla.
 *
 * El modal NO se cierra al agregar: una ronda son varias cosas, y cerrarse
 * después de cada una obliga a abrirlo otra vez por cada chop.
 */

export type ProductoMesa = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  categoria: string | null;
  imagen_url: string | null;
  controla_stock: boolean;
  stock_actual: number | null;
};

const fmtGs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

const TODAS = "__todas__";

export default function PickerProductos({
  abierto,
  onCerrar,
  onAgregar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** Suma el producto a la ronda que se está armando. */
  onAgregar: (p: ProductoMesa, cantidad: number) => void;
}) {
  const [productos, setProductos] = useState<ProductoMesa[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string>(TODAS);
  const [q, setQ] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const cargadoRef = useRef(false);

  useEffect(() => {
    if (!abierto || cargadoRef.current) return;
    cargadoRef.current = true;
    setCargando(true);
    fetchWithSupabaseSession("/api/mesas/productos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) setProductos((j.data?.items ?? []) as ProductoMesa[]);
        else setError(j?.error ?? "No se pudo cargar la carta.");
      })
      .catch(() => setError("Error de red."))
      .finally(() => setCargando(false));
  }, [abierto]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const p of productos) set.add(p.categoria || "Sin categoría");
    return [...set].sort();
  }, [productos]);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return productos.filter((p) => {
      const cat = p.categoria || "Sin categoría";
      if (categoria !== TODAS && cat !== categoria) return false;
      if (term && !`${p.nombre} ${p.sku}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [productos, categoria, q]);

  if (!abierto) return null;

  /**
   * Lo que se compra hecho (gaseosa, agua) no se puede servir si no hay. Lo que
   * se prepara no tiene stock propio: su faltante aparece al mandar la ronda,
   * cuando se mira el granel o los insumos.
   */
  function sinStock(p: ProductoMesa): boolean {
    return p.controla_stock && (p.stock_actual ?? 0) <= 0;
  }

  function elegir(p: ProductoMesa) {
    if (sinStock(p)) {
      setAviso(`${p.nombre} está sin stock.`);
      setTimeout(() => setAviso(null), 2500);
      return;
    }
    onAgregar(p, 1);
    setAviso(`${p.nombre} agregado`);
    setTimeout(() => setAviso(null), 1200);
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 p-2 backdrop-blur-sm sm:p-4"
      onClick={onCerrar}
    >
      <div
        className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-3">
          <h3 className="text-lg font-semibold text-slate-800">Agregar a la ronda</h3>
          <button
            type="button"
            onClick={onCerrar}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden /> Listo
          </button>
        </div>

        <div className="border-b border-slate-200 p-3">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en la carta…"
              autoFocus
              className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-base outline-none focus:ring-2 focus:ring-[#4FAEB2]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip activo={categoria === TODAS} onClick={() => setCategoria(TODAS)}>
              Todas
            </Chip>
            {categorias.map((c) => (
              <Chip key={c} activo={categoria === c} onClick={() => setCategoria(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {aviso && (
            <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              {aviso}
            </div>
          )}
          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {cargando ? (
            <p className="py-10 text-center text-slate-400">Cargando la carta…</p>
          ) : visibles.length === 0 ? (
            <p className="py-10 text-center text-slate-400">
              {productos.length === 0
                ? "No hay productos cargados en esta sucursal."
                : "Nada coincide con la búsqueda."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visibles.map((p) => {
                const bloqueado = sinStock(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => elegir(p)}
                    disabled={bloqueado}
                    className={`flex flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition ${
                      bloqueado
                        ? "cursor-not-allowed border-red-200 opacity-60"
                        : "border-slate-200 hover:border-[#4FAEB2] active:scale-95"
                    }`}
                  >
                    <div className="h-24 w-full bg-slate-100">
                      {p.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imagen_url} alt={p.nombre} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-300">
                          <Beer className="h-6 w-6" aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 text-sm font-medium text-slate-800">{p.nombre}</p>
                      <p className="mt-0.5 text-sm font-bold text-[#3F8E91]">{fmtGs(p.precio_venta)}</p>
                      {p.controla_stock ? (
                        <p
                          className={`mt-0.5 text-[11px] font-medium ${
                            (p.stock_actual ?? 0) <= 0 ? "text-red-500" : "text-slate-500"
                          }`}
                        >
                          {(p.stock_actual ?? 0) <= 0 ? "Sin stock" : `Stock: ${p.stock_actual}`}
                        </p>
                      ) : (
                        <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          Se prepara
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
        activo ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
