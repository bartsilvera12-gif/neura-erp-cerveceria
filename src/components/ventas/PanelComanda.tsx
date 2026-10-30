"use client";

import { UtensilsCrossed } from "lucide-react";

/**
 * Datos del pedido que se manda a la barra / cocina junto con la venta.
 *
 * QUE ES Y QUE NO ES
 * Esto es la ETAPA A del servicio de mesa: se cobra primero, como siempre, y
 * la venta además deja una comanda con la mesa. NO es una cuenta abierta: no
 * se agregan rondas a lo largo de la noche ni se cierra la mesa al final.
 *
 * El backend ya recibía estos datos (`pedido_cocina` en `/api/ventas/create`)
 * y con ellos crea la tarjeta en el tablero de Pedidos; lo que faltaba era
 * mandárselos desde esta pantalla.
 */

export type Modalidad = "local" | "carry_out" | "delivery";

export type DatosComanda = {
  modalidad: Modalidad;
  mesa: string;
  observacion: string;
  cliente_nombre: string;
  cliente_telefono: string;
  direccion_entrega: string;
};

export const COMANDA_VACIA: DatosComanda = {
  modalidad: "local",
  mesa: "",
  observacion: "",
  cliente_nombre: "",
  cliente_telefono: "",
  direccion_entrega: "",
};

/**
 * El panel queda abierto o cerrado según cada terminal, y se recuerda.
 *
 * La caja del bar lo deja abierto; la de la fábrica, que vende barriles, no lo
 * abre nunca y no se entera de que existe. Es una preferencia de esta pantalla
 * en este navegador, así que vive en localStorage y no en la base.
 */
const CLAVE = "neura.comanda.abierta.v1";

export function leerPreferenciaComanda(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

/** `null` cuando no hay nada que mandar, para pasarlo tal cual a `saveVenta`. */
export function comandaParaGuardar(
  activa: boolean,
  d: DatosComanda
): {
  modalidad: Modalidad;
  mesa: string | null;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  direccion_entrega: string | null;
  observacion: string | null;
} | null {
  if (!activa) return null;
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    modalidad: d.modalidad,
    mesa: t(d.mesa),
    cliente_nombre: t(d.cliente_nombre),
    cliente_telefono: t(d.cliente_telefono),
    direccion_entrega: t(d.direccion_entrega),
    observacion: t(d.observacion),
  };
}

/** Lo que el servidor va a rechazar, dicho acá antes de mandar la venta. */
export function errorComanda(activa: boolean, d: DatosComanda): string | null {
  if (!activa) return null;
  if (d.modalidad === "local" && d.mesa.trim() === "") {
    return "Poné el número de mesa, o cambiá la modalidad a Para llevar.";
  }
  if (d.modalidad === "delivery" && (d.cliente_telefono.trim() === "" || d.direccion_entrega.trim() === "")) {
    return "Para delivery hacen falta el teléfono y la dirección.";
  }
  return null;
}

const MODALIDADES: Array<{ value: Modalidad; label: string }> = [
  { value: "local", label: "En el salón" },
  { value: "carry_out", label: "Para llevar" },
  { value: "delivery", label: "Delivery" },
];

export default function PanelComanda({
  activa,
  onActivaChange,
  datos,
  onChange,
  inputClass,
  labelClass,
}: {
  activa: boolean;
  onActivaChange: (v: boolean) => void;
  datos: DatosComanda;
  onChange: (d: DatosComanda) => void;
  inputClass: string;
  labelClass: string;
}) {
  function set<K extends keyof DatosComanda>(k: K, v: DatosComanda[K]) {
    onChange({ ...datos, [k]: v });
  }

  function toggle(v: boolean) {
    onActivaChange(v);
    try {
      localStorage.setItem(CLAVE, v ? "1" : "0");
    } catch {
      /* sin localStorage (ventana privada) el panel igual funciona, sólo no se recuerda */
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={activa}
          onChange={(e) => toggle(e.target.checked)}
          className="rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
        />
        <UtensilsCrossed className="h-4 w-4 text-slate-400" aria-hidden />
        <span className="text-sm font-semibold text-slate-700">Mandar comanda a la barra / cocina</span>
      </label>

      {!activa && (
        <p className="mt-1 pl-6 text-xs text-slate-500">
          Imprime la comanda sin precios y deja el pedido en el tablero, con la mesa.
        </p>
      )}

      {activa && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {MODALIDADES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => set("modalidad", m.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  datos.modalidad === m.value
                    ? "bg-[#4FAEB2] text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {datos.modalidad === "local" && (
              <div>
                <label className={labelClass}>Mesa</label>
                <input
                  type="text"
                  value={datos.mesa}
                  onChange={(e) => set("mesa", e.target.value)}
                  placeholder="Ej: 5, Barra, Terraza 2"
                  className={inputClass}
                />
              </div>
            )}

            {datos.modalidad === "delivery" && (
              <>
                <div>
                  <label className={labelClass}>Nombre de quien recibe</label>
                  <input
                    type="text"
                    value={datos.cliente_nombre}
                    onChange={(e) => set("cliente_nombre", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Teléfono</label>
                  <input
                    type="tel"
                    value={datos.cliente_telefono}
                    onChange={(e) => set("cliente_telefono", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Dirección de entrega</label>
                  <input
                    type="text"
                    value={datos.direccion_entrega}
                    onChange={(e) => set("direccion_entrega", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </>
            )}

            <div className={datos.modalidad === "local" ? "" : "sm:col-span-2"}>
              <label className={labelClass}>
                Observación <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                type="text"
                value={datos.observacion}
                onChange={(e) => set("observacion", e.target.value)}
                placeholder="Ej: sin hielo, la papa bien dorada"
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
