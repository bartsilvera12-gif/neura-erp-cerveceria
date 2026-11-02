"use client";

import { useEffect, useState } from "react";
import { getModuleAccessCached, peekModuleAccessCache } from "@/lib/modulos/module-access-cache";

/**
 * ¿Esta persona cobra, o sólo atiende las mesas?
 *
 * El mozo abre la mesa, manda las rondas y la cierra; cobrar es de la Caja, y
 * son dos personas distintas en dos aparatos distintos. El permiso ya existe
 * —el módulo `ventas`—; esto es para que las pantallas del salón no le ofrezcan
 * al mozo un botón que lo iba a mandar a una pantalla que no puede abrir.
 *
 * Mientras no se sabe, `puedeCobrar` es `false` y `cargando` es `true`: más vale
 * no mostrar el botón medio segundo que mostrarlo y que no funcione.
 */
export function usePuedeCobrar(): { puedeCobrar: boolean; cargando: boolean } {
  const inicial = typeof window === "undefined" ? null : peekModuleAccessCache();
  const [puedeCobrar, setPuedeCobrar] = useState(() => resolver(inicial));
  const [cargando, setCargando] = useState(inicial == null);

  useEffect(() => {
    let cancel = false;
    getModuleAccessCached()
      .then(({ ok, data }) => {
        if (cancel) return;
        if (ok) setPuedeCobrar(resolver(data));
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  return { puedeCobrar, cargando };
}

function resolver(data: { superAdmin?: boolean; slugs?: string[] } | null): boolean {
  if (!data) return false;
  if (data.superAdmin) return true;
  return Array.isArray(data.slugs) && data.slugs.includes("ventas");
}
