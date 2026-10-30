"use client";

import { useState } from "react";

/** Formatea número con separador de miles (Paraguay: 1.200.000) */
export function formatMontoDisplay(value: number | string, decimals = true): string {
  const n = typeof value === "string" ? parseMontoInput(value) : value;
  if (isNaN(n) || (typeof value === "number" && isNaN(value))) return "";
  return n.toLocaleString("es-PY", {
    minimumFractionDigits: decimals ? 0 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

/** Parsea string con formato a número (acepta "1.200.000", "1.234,50", "1234.56") */
export function parseMontoInput(value: string): number {
  if (!value || !value.trim()) return 0;
  const v = value.replace(/\s/g, "");
  if (v.includes(",")) {
    const [intPart, decPart] = v.split(",");
    const n = parseFloat((intPart || "").replace(/\./g, "") + "." + (decPart || "0"));
    return isNaN(n) ? 0 : n;
  }
  const parts = v.split(".");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  const last = parts[parts.length - 1] || "";
  if (last.length <= 2 && /^\d+$/.test(last)) {
    return parseFloat(parts.slice(0, -1).join("") + "." + last) || 0;
  }
  return parseFloat(parts.join("")) || 0;
}

type MontoInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | string;
  onChange: (value: number) => void;
  /** Si true, permite decimales. Default: true */
  decimals?: boolean;
};

/**
 * Input de monto con separador de miles.
 * Muestra el valor formateado (ej: 1.200.000) y emite el número al cambiar.
 *
 * EL "0" QUE NO SE PODIA BORRAR
 * Antes el valor mostrado se derivaba siempre del número: al borrar el último
 * dígito, `parseMontoInput("")` devolvía 0 y React volvía a escribir "0". El
 * campo nunca quedaba vacío, así que lo que se tipeaba se sumaba detrás del
 * cero y había que seleccionar todo a mano para corregirlo. Es el mismo
 * problema que ya se arregló en `NumeroInput`.
 *
 * Ahora, mientras el campo está en edición, el texto vive acá: se puede dejar
 * vacío, el número se avisa igual (vacío = 0) y al salir del campo se vuelve a
 * mostrar formateado. Al enfocar se selecciona todo, así tipear reemplaza.
 */
export default function MontoInput({
  value,
  onChange,
  decimals = true,
  className = "",
  ...rest
}: MontoInputProps) {
  const [texto, setTexto] = useState<string | null>(null);

  const numValue = typeof value === "string"
    ? (value === "" ? 0 : parseMontoInput(value))
    : Number(value) || 0;
  const formateado = (typeof value === "string" && value === "") ? "" : formatMontoDisplay(numValue, decimals);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const crudo = e.target.value;
    // Sólo dígitos y un separador: así no se pega texto que después se
    // interpreta como 0 sin que se note.
    if (!/^[0-9.,\s]*$/.test(crudo)) return;
    setTexto(crudo);
    onChange(parseMontoInput(crudo));
  };

  return (
    <input
      // `rest` va primero: si lo spreadeamos al final, un `onBlur` del caller
      // reemplazaria al de aca y el texto en edicion nunca se soltaria.
      {...rest}
      type="text"
      inputMode="decimal"
      value={texto ?? formateado}
      onChange={handleChange}
      onFocus={(e) => {
        setTexto(e.target.value);
        e.target.select();
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setTexto(null);
        rest.onBlur?.(e);
      }}
      className={className}
    />
  );
}
