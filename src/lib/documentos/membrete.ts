/**
 * Membrete (encabezado) común para todos los documentos imprimibles del ERP.
 * Devuelve HTML con estilos inline para no depender del CSS de cada endpoint
 * (evita duplicar el markup del encabezado en cada documento).
 *
 * SOLO presentación: no toca datos de negocio. Los datos comerciales son fijos
 * de la empresa (Cervecería).
 */

export const EMPRESA_DOC = {
  nombre: "Coven BrewingPY",
  actividad: [
    "Comercio al por menor de otros productos en comercios no especializados",
    "Venta de plantas, bancos, jardinería, otros",
  ],
  telefono: "(0971) 861 676",
  direccion: ["200 mts. en Sur Club Costa Ñu", "Ruta Pyca - Caacupé", "Cordillera - Paraguay"],
  /** Logo del cliente (alta calidad, fondo transparente). Servido desde /public. */
  logoUrl: "/brand/coven-doc-logo.png",
  /**
   * Variante para ticket térmico.
   *
   * El logo es dorado, y una impresora térmica es monocromo: el dorado sale
   * gris lavado y el logo se pierde. Esta versión está pasada a trazo negro,
   * que es lo que imprime bien en papel térmico.
   */
  logoTicketUrl: "/brand/coven-ticket-logo.png",
};

/**
 * Override de marca por sucursal (logo, teléfono, dirección). El NOMBRE legal y
 * la actividad NO se sobreescriben (misma empresa/RUC). Cuando una sucursal tiene
 * su propia identidad visual (p. ej. Reserva Market), sus documentos la usan;
 * las que no, caen a `EMPRESA_DOC`.
 */
export type MembreteMarca = {
  logoUrl?: string | null;
  /** Logo en blanco y negro para ticket térmico. Si falta, se usa `logoUrl`. */
  logoTicketUrl?: string | null;
  telefono?: string | null;
  direccion?: string[] | null;
};

function resolverMarca(marca?: MembreteMarca) {
  const logo = (marca?.logoUrl && marca.logoUrl.trim()) || EMPRESA_DOC.logoUrl;
  return {
    nombre: EMPRESA_DOC.nombre,
    actividad: EMPRESA_DOC.actividad,
    logoUrl: logo,
    // Una sucursal con logo propio pero sin variante de ticket usa el suyo, no
    // el blanco y negro de otra marca.
    logoTicketUrl:
      (marca?.logoTicketUrl && marca.logoTicketUrl.trim()) ||
      (marca?.logoUrl && marca.logoUrl.trim()) ||
      EMPRESA_DOC.logoTicketUrl,
    telefono: (marca?.telefono && marca.telefono.trim()) || EMPRESA_DOC.telefono,
    direccion: marca?.direccion && marca.direccion.length ? marca.direccion : EMPRESA_DOC.direccion,
  };
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete A4: logo a la izquierda, datos comerciales a la derecha, línea divisoria.
 * `marca` opcional: override de logo/teléfono/dirección por sucursal.
 */
export function membreteA4(marca?: MembreteMarca): string {
  const e = resolverMarca(marca);
  const logo = e.logoUrl;
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #2E7D32;padding-bottom:12px;margin-bottom:16px;">
    <div style="flex:0 0 auto;">
      <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:160px;max-height:112px;width:auto;height:auto;object-fit:contain;display:block;" />
    </div>
    <div style="flex:1;min-width:0;text-align:right;font-size:11px;color:#374151;line-height:1.55;">
      <div style="font-size:14px;font-weight:800;color:#1f2937;">${esc(e.nombre)}</div>
      ${e.actividad.map((a) => `<div style="color:#6b7280;">${esc(a)}</div>`).join("")}
      <div style="margin-top:4px;"><strong>Tel:</strong> ${esc(e.telefono)}</div>
      <div>${e.direccion.map(esc).join(" · ")}</div>
    </div>
  </div>`;
}

/**
 * Membrete compacto para ticket angosto (58/80mm): logo arriba, datos centrados.
 * `marca` opcional: override de logo/teléfono/dirección por sucursal.
 */
export function membreteTicket(marca?: MembreteMarca): string {
  const e = resolverMarca(marca);
  const logo = e.logoTicketUrl;
  return `
  <div style="text-align:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px dashed #000;">
    <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:140px;max-height:96px;width:auto;height:auto;object-fit:contain;display:inline-block;margin:0 auto 4px;" />
    <div style="font-weight:700;font-size:12px;">${esc(e.nombre)}</div>
    <div style="font-size:10px;">Tel: ${esc(e.telefono)}</div>
    <div style="font-size:10px;">${esc(e.direccion[0])}</div>
    <div style="font-size:10px;">${esc(e.direccion.slice(1).join(" · "))}</div>
  </div>`;
}
