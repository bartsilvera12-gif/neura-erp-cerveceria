import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { exigirSucursal, respuestaSucursalNoAsignada } from "@/lib/sucursales/filtro";
import { leerMesa } from "@/lib/mesas/server/mesas-pg";
import { itemsDeRonda, siguienteRonda } from "@/lib/mesas/mesas-domain";
import { fechaHoraPy } from "@/lib/fecha/paraguay";

/**
 * GET /api/mesas/[id]/comanda?ronda=N&w=58|80&auto=1
 *
 * La comanda de UNA ronda, para imprimir en la barra o la cocina.
 *
 * Sin precios: lo que la cocina necesita es qué preparar y para qué mesa. Y
 * sólo la ronda pedida: si imprimiera toda la cuenta, a la tercera vuelta la
 * cocina volvería a preparar lo de la primera.
 *
 * Sin `ronda` imprime la última.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    const r = await leerMesa(ctx.supabase, ctx.auth.empresa_id, exigirSucursal(ctx.auth), id);
    if (!r) return NextResponse.json(errorResponse("Esa mesa no existe."), { status: 404 });

    const url = new URL(request.url);
    const pedida = Number(url.searchParams.get("ronda"));
    const ronda = Number.isInteger(pedida) && pedida > 0 ? pedida : siguienteRonda(r.mesa.items) - 1;
    const items = itemsDeRonda(r.mesa.items, ronda);
    const ancho = url.searchParams.get("w") === "58" ? 58 : 80;
    const auto = url.searchParams.get("auto") === "1";
    const fontPx = ancho === 58 ? 11 : 12;

    const filas =
      items.length === 0
        ? `<tr><td class="vacio">Esta ronda no tiene productos.</td></tr>`
        : items
            .map(
              (i) => `<tr>
                 <td class="qty"><strong>${i.cantidad}×</strong></td>
                 <td class="name"><strong>${escapeHtml(i.producto_nombre)}</strong>${
                   i.observacion ? `<div class="obs-item">${escapeHtml(i.observacion)}</div>` : ""
                 }</td>
               </tr>`
            )
            .join("");

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Comanda · Mesa ${escapeHtml(r.mesa.mesa)} · Ronda ${ronda}</title>
<style>
  @page { size: ${ancho}mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: ${fontPx}px; margin: 0; padding: 4mm; background: #f1f5f9; color: #000; }
  .paper { background: #fff; width: ${ancho}mm; margin: 0 auto; padding: 3mm; }
  .banner { font-size: ${fontPx + 6}px; font-weight: 800; text-align: center; padding: 2mm; border: 2px solid #000; margin-bottom: 3mm; letter-spacing: 1px; }
  .mesa { font-size: ${fontPx + 10}px; font-weight: 800; text-align: center; margin: 0 0 1mm; }
  .sub { text-align: center; margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.2mm 0; vertical-align: top; }
  td.qty { width: 10mm; font-size: ${fontPx + 2}px; }
  td.name { font-size: ${fontPx + 2}px; }
  .obs-item { font-weight: 400; font-style: italic; padding-left: 2mm; }
  .vacio { text-align: center; font-style: italic; padding: 4mm 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .pie { text-align: center; margin-top: 3mm; }
  .barra { max-width: ${ancho}mm; margin: 0 auto 3mm; display: flex; gap: 8px; justify-content: center; }
  .barra button, .barra a { font: inherit; padding: 6px 10px; border: 1px solid #94a3b8; background: #fff; border-radius: 6px; cursor: pointer; text-decoration: none; color: #0f172a; }
  @media print { body { background: #fff; padding: 0; } .paper { width: auto; } .barra { display: none; } }
</style></head>
<body>
  <div class="barra">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a href="?ronda=${ronda}&w=${ancho === 80 ? 58 : 80}">Cambiar a ${ancho === 80 ? 58 : 80}mm</a>
  </div>
  <section class="paper">
    <div class="banner">COMANDA</div>
    <div class="mesa">MESA ${escapeHtml(r.mesa.mesa)}</div>
    <div class="sub">Ronda ${ronda} · ${escapeHtml(fechaHoraPy(new Date()))}</div>
    <hr>
    <table><tbody>${filas}</tbody></table>
    ${r.mesa.observacion ? `<hr><div class="pie">${escapeHtml(r.mesa.observacion)}</div>` : ""}
  </section>
  ${auto ? `<script>try{ window.print(); }catch(e){}</script>` : ""}
</body></html>`;

    return new NextResponse(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    const rSuc = respuestaSucursalNoAsignada(err);
    if (rSuc) return rSuc;
    console.error("[/api/mesas/[id]/comanda]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar la comanda."), { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
