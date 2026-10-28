"use client";

import { useState } from "react";

/**
 * Campo numérico que SÍ se deja vaciar.
 *
 * Un `<input type="number" value={n}>` controlado contra un número no se puede
 * borrar: al quitar el último dígito el onChange recibe `""`, el `|| 0` (o
 * `|| 1`) lo convierte de vuelta en el valor anterior y React lo vuelve a
 * escribir. El resultado es que el "0" queda pegado adelante y lo que se tipea
 * se le suma detrás: querer cargar 500 en un campo que muestra 0 termina en
 * 0500, y no hay forma de corregirlo sin seleccionar todo a mano.
 *
 * Acá el texto en edición vive en el componente y el número se avisa recién
 * cuando es válido. Vacío se interpreta como `fallback` al salir del campo, y
 * al enfocar se selecciona todo para que tipear reemplace en vez de agregar.
 */
export default function NumeroInput({
  value,
  onChange,
  min = 0,
  max,
  fallback = min,
  decimales = true,
  className,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** Valor que queda si el campo se deja vacío. Por defecto, `min`. */
  fallback?: number;
  /** `false` para cantidades enteras (unidades, cuotas, niveles). */
  decimales?: boolean;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const patron = decimales ? /^[0-9]*[.,]?[0-9]*$/ : /^[0-9]*$/;

  function avisar(raw: string) {
    if (raw.trim() === "") return;
    let n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) return;
    if (!decimales) n = Math.trunc(n);
    n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onChange(n);
  }

  return (
    <input
      // `type="text"` a propósito: con `type="number"` el navegador no expone
      // la posición del cursor y el caret salta al final en cada corrección.
      type="text"
      inputMode={decimales ? "decimal" : "numeric"}
      value={texto ?? String(value)}
      onChange={(e) => {
        const v = e.target.value;
        if (!patron.test(v)) return;
        setTexto(v);
        avisar(v);
      }}
      onFocus={(e) => {
        setTexto(e.target.value);
        e.target.select();
      }}
      onBlur={() => {
        if (texto != null && texto.trim() === "") onChange(fallback);
        setTexto(null);
      }}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}
