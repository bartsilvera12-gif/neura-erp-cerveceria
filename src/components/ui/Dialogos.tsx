"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Info, X } from "lucide-react";

/**
 * Avisos, confirmaciones y pedidos de texto dentro del ERP.
 *
 * Antes esto era `confirm()` y `alert()` del navegador. Eso trae tres
 * problemas que no se arreglan con CSS:
 *
 *   · El cartel dice "cerveceria.neura.com.py dice", que es el navegador
 *     hablando, no el sistema. Al operador le parece un mensaje de la web y no
 *     del ERP, y algunos navegadores ofrecen "no volver a mostrar mensajes de
 *     este sitio": si alguien lo tilda, deja de aparecer la confirmación de
 *     facturar y la acción se dispara sin preguntar.
 *   · Bloquean el hilo del navegador. Mientras el cartel está abierto no se
 *     renderiza nada: ni un spinner, ni un dato que acaba de llegar.
 *   · No se pueden probar ni dar estilo.
 *
 * La API devuelve promesas para que migrar cueste una línea:
 *
 *     if (!confirm("¿Borrar?")) return;          // antes
 *     if (!(await confirmar("¿Borrar?"))) return; // ahora
 */

export type TonoDialogo = "normal" | "peligro";

export type OpcionesConfirmar = {
  titulo?: string;
  mensaje: string;
  /** Texto del botón que sigue adelante. */
  confirmar?: string;
  cancelar?: string;
  tono?: TonoDialogo;
};

export type OpcionesAviso = {
  titulo?: string;
  mensaje: string;
  tono?: TonoDialogo;
};

export type OpcionesTexto = {
  titulo?: string;
  mensaje: string;
  placeholder?: string;
  valorInicial?: string;
  /** Largo mínimo exigido. Se valida acá para no mandar a la API algo que va a rebotar. */
  minimo?: number;
  confirmar?: string;
  multilinea?: boolean;
};

type Pendiente =
  | { tipo: "confirmar"; op: Required<Omit<OpcionesConfirmar, "titulo">> & { titulo?: string }; resolver: (v: boolean) => void }
  | { tipo: "aviso"; op: OpcionesAviso; resolver: (v: void) => void }
  | { tipo: "texto"; op: OpcionesTexto; resolver: (v: string | null) => void };

type Api = {
  confirmar: (op: OpcionesConfirmar | string) => Promise<boolean>;
  avisar: (op: OpcionesAviso | string) => Promise<void>;
  pedirTexto: (op: OpcionesTexto) => Promise<string | null>;
};

const Ctx = createContext<Api | null>(null);

/**
 * Fuera del provider las funciones caen a los diálogos del navegador en vez de
 * tirar error. Una pantalla que se renderice sin el provider (un test, un
 * árbol suelto) tiene que seguir preguntando antes de borrar algo: perder el
 * estilo es aceptable, perder la confirmación no.
 */
const RESPALDO: Api = {
  confirmar: async (op) =>
    typeof window === "undefined"
      ? false
      : window.confirm(typeof op === "string" ? op : op.mensaje),
  avisar: async (op) => {
    if (typeof window !== "undefined") window.alert(typeof op === "string" ? op : op.mensaje);
  },
  pedirTexto: async (op) =>
    typeof window === "undefined" ? null : window.prompt(op.mensaje, op.valorInicial ?? ""),
};

export function useDialogos(): Api {
  return useContext(Ctx) ?? RESPALDO;
}

export default function DialogosProvider({ children }: { children: React.ReactNode }) {
  // Cola y no un solo pendiente: si dos avisos se disparan en el mismo tick
  // (p. ej. dos validaciones), el segundo no puede tapar al primero.
  const [cola, setCola] = useState<Pendiente[]>([]);
  const actual = cola[0] ?? null;

  const encolar = useCallback((p: Pendiente) => setCola((q) => [...q, p]), []);

  const cerrar = useCallback(() => setCola((q) => q.slice(1)), []);

  const api = useMemo<Api>(
    () => ({
      confirmar: (op) =>
        new Promise<boolean>((resolver) => {
          const o = typeof op === "string" ? { mensaje: op } : op;
          encolar({
            tipo: "confirmar",
            op: {
              titulo: o.titulo,
              mensaje: o.mensaje,
              confirmar: o.confirmar ?? "Confirmar",
              cancelar: o.cancelar ?? "Cancelar",
              tono: o.tono ?? "normal",
            },
            resolver,
          });
        }),
      avisar: (op) =>
        new Promise<void>((resolver) => {
          const o = typeof op === "string" ? { mensaje: op } : op;
          encolar({ tipo: "aviso", op: o, resolver });
        }),
      pedirTexto: (op) =>
        new Promise<string | null>((resolver) => {
          encolar({ tipo: "texto", op, resolver });
        }),
    }),
    [encolar]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {actual && <Dialogo key={cola.length} pendiente={actual} alCerrar={cerrar} />}
    </Ctx.Provider>
  );
}

function Dialogo({ pendiente, alCerrar }: { pendiente: Pendiente; alCerrar: () => void }) {
  const [texto, setTexto] = useState(
    pendiente.tipo === "texto" ? pendiente.op.valorInicial ?? "" : ""
  );
  const [error, setError] = useState<string | null>(null);
  const primero = useRef<HTMLElement | null>(null);
  // Que no se resuelva dos veces: un Escape y un click en el fondo a la vez
  // dejarían la promesa resuelta y la cola corrida de más.
  const resuelto = useRef(false);

  const terminar = useCallback(
    (accion: "ok" | "cancelar") => {
      if (resuelto.current) return;
      resuelto.current = true;
      if (pendiente.tipo === "confirmar") pendiente.resolver(accion === "ok");
      else if (pendiente.tipo === "aviso") pendiente.resolver();
      else pendiente.resolver(accion === "ok" ? texto.trim() : null);
      alCerrar();
    },
    [pendiente, texto, alCerrar]
  );

  const aceptar = useCallback(() => {
    if (pendiente.tipo === "texto") {
      const min = pendiente.op.minimo ?? 0;
      if (texto.trim().length < min) {
        setError(
          min === 1
            ? "Escribí algo para continuar."
            : `Escribí al menos ${min} caracteres (van ${texto.trim().length}).`
        );
        return;
      }
    }
    terminar("ok");
  }, [pendiente, texto, terminar]);

  useEffect(() => {
    const t = setTimeout(() => primero.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        terminar("cancelar");
      }
      // Enter acepta, salvo en un texto de varias líneas donde sirve para
      // saltar de renglón.
      if (e.key === "Enter" && !(pendiente.tipo === "texto" && pendiente.op.multilinea)) {
        const dentro = (e.target as HTMLElement)?.tagName === "TEXTAREA";
        if (!dentro) {
          e.preventDefault();
          aceptar();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendiente, aceptar, terminar]);

  const peligro =
    (pendiente.tipo === "confirmar" && pendiente.op.tono === "peligro") ||
    (pendiente.tipo === "aviso" && pendiente.op.tono === "peligro");

  const titulo =
    pendiente.op.titulo ??
    (pendiente.tipo === "confirmar"
      ? "Confirmar"
      : pendiente.tipo === "aviso"
        ? peligro
          ? "No se pudo continuar"
          : "Aviso"
        : "Escribí el motivo");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) terminar("cancelar");
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              peligro ? "bg-red-50 text-red-600" : "bg-[#4FAEB2]/10 text-[#4FAEB2]"
            }`}
            aria-hidden
          >
            {peligro ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {pendiente.op.mensaje}
            </p>
          </div>
          <button
            type="button"
            onClick={() => terminar("cancelar")}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded p-1 text-slate-400 transition-colors hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {pendiente.tipo === "texto" && (
          <div className="px-5 pb-1">
            {pendiente.op.multilinea ? (
              <textarea
                ref={primero as React.RefObject<HTMLTextAreaElement>}
                value={texto}
                rows={3}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setError(null);
                }}
                placeholder={pendiente.op.placeholder}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-1 focus:ring-[#4FAEB2]"
              />
            ) : (
              <input
                ref={primero as React.RefObject<HTMLInputElement>}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setError(null);
                }}
                placeholder={pendiente.op.placeholder}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-1 focus:ring-[#4FAEB2]"
              />
            )}
            {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          {pendiente.tipo !== "aviso" && (
            <button
              type="button"
              onClick={() => terminar("cancelar")}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              {pendiente.tipo === "confirmar" ? pendiente.op.cancelar : "Cancelar"}
            </button>
          )}
          <button
            type="button"
            ref={
              pendiente.tipo === "texto"
                ? undefined
                : (primero as React.RefObject<HTMLButtonElement>)
            }
            onClick={aceptar}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              peligro ? "bg-red-600 hover:bg-red-700" : "bg-[#4FAEB2] hover:bg-[#3F8E91]"
            }`}
          >
            {pendiente.tipo === "confirmar"
              ? pendiente.op.confirmar
              : pendiente.tipo === "texto"
                ? pendiente.op.confirmar ?? "Confirmar"
                : "Entendido"}
          </button>
        </div>
      </div>
    </div>
  );
}
