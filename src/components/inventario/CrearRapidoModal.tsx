"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { errorNombre, errorRuc, primerError } from "@/lib/validacion/documentos";

/**
 * Alta rápida de una categoría o un proveedor sin salir del formulario de
 * producto.
 *
 * Antes el "+ Crear" era un link a otra pantalla: el operador perdía el
 * producto a medio cargar y tenía que empezarlo de nuevo. Acá se crea lo que
 * falta, se devuelve el id y el select queda apuntando a lo recién creado.
 *
 * El proveedor pide nombre Y RUC porque sin RUC no se le puede cargar una
 * compra ni una factura: crearlo "solo con el nombre" obliga a volver a
 * Proveedores a completarlo antes de poder usarlo.
 */

export type CrearRapidoTipo = "categoria" | "proveedor";

const COPY: Record<CrearRapidoTipo, { titulo: string; etiquetaNombre: string; placeholder: string }> = {
  categoria: {
    titulo: "Nueva categoría",
    etiquetaNombre: "Nombre de la categoría",
    placeholder: "Ej: Maltas",
  },
  proveedor: {
    titulo: "Nuevo proveedor",
    etiquetaNombre: "Nombre o razón social",
    placeholder: "Ej: DISTRIBUIDORA DEL SUR S.A.",
  },
};

export default function CrearRapidoModal({
  tipo,
  open,
  onClose,
  onCreado,
}: {
  tipo: CrearRapidoTipo;
  open: boolean;
  onClose: () => void;
  /** Recibe lo creado para que el formulario lo agregue a su lista y lo seleccione. */
  onCreado: (creado: { id: string; nombre: string }) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const nombreRef = useRef<HTMLInputElement>(null);
  const copy = COPY[tipo];

  useEffect(() => {
    if (!open) return;
    setNombre("");
    setRuc("");
    setError(null);
    setGuardando(false);
    const t = setTimeout(() => nombreRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, tipo]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;

    const eFormato = primerError(
      errorNombre(nombre, tipo === "categoria" ? "El nombre" : "La razón social", { obligatorio: true }),
      // El RUC es obligatorio solo para proveedores: una categoría no tiene.
      tipo === "proveedor" ? errorRuc(ruc, { obligatorio: true }) : null
    );
    if (eFormato) return setError(eFormato);

    setGuardando(true);
    setError(null);
    try {
      const url = tipo === "categoria" ? "/api/inventario/categorias" : "/api/proveedores";
      const body =
        tipo === "categoria"
          ? { nombre: nombre.trim() }
          : { nombre: nombre.trim(), ruc: ruc.trim(), estado: "activo" };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `No se pudo crear (${r.status}).`);
        return;
      }
      const creado = (j.data?.categoria ?? j.data?.proveedor ?? null) as
        | { id?: string; nombre?: string }
        | null;
      if (!creado?.id) {
        setError("Se creó, pero no se pudo seleccionar. Recargá la página.");
        return;
      }
      onCreado({ id: String(creado.id), nombre: String(creado.nombre ?? nombre.trim()) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{copy.titulo}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-400 transition-colors hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-600" htmlFor="crear-rapido-nombre">
            {copy.etiquetaNombre} <span className="text-red-500">*</span>
          </label>
          <input
            id="crear-rapido-nombre"
            ref={nombreRef}
            type="text"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setError(null);
            }}
            placeholder={copy.placeholder}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-[#0EA5E9]"
            autoComplete="off"
          />
        </div>

        {tipo === "proveedor" && (
          <div>
            <label className="mb-1 block text-xs text-slate-600" htmlFor="crear-rapido-ruc">
              RUC <span className="text-red-500">*</span>
            </label>
            <input
              id="crear-rapido-ruc"
              type="text"
              value={ruc}
              onChange={(e) => {
                setRuc(e.target.value);
                setError(null);
              }}
              placeholder="80012345-7"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9]"
              autoComplete="off"
              inputMode="numeric"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Sin RUC no se le puede cargar una compra ni una factura.
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0284C7] disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Crear"}
          </button>
        </div>
      </form>
    </div>
  );
}
