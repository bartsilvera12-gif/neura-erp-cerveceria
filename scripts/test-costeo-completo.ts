/**
 * Tests de `costearReceta`.
 *
 * La prueba principal es reproducir el lote de 500 L de la planilla de COVEN:
 * si el modelo del ERP da los mismos litros vendibles, el mismo costo por litro
 * y las mismas unidades por formato que la planilla que el cliente ya usa,
 * entonces no cambiamos su negocio por debajo, sólo lo movimos de lugar.
 *
 * Correr con: npm run test:costeo
 */
import {
  costearReceta,
  type EntradaCosteo,
  type FormatoEnvasado,
} from "../src/lib/recetas/costeo-completo";

let fallos = 0;
let corridas = 0;

function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) {
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`);
  }
}

function cerca(nombre: string, real: number | null, esperado: number, tol = 0.5) {
  const bien = real != null && Math.abs(real - esperado) <= tol;
  ok(nombre, bien, `esperaba ${esperado}, dio ${real}`);
}

// ---------------------------------------------------------------------------
// El lote de 500 L de la planilla de COVEN
// ---------------------------------------------------------------------------
const fmt = (
  nombre: string,
  litros: number,
  rend: number,
  envase: number,
  tapa: number,
  etiqueta: number,
  pack: number,
  velocidad: number,
  operarios: number
): FormatoEnvasado => ({
  formato_id: nombre,
  producto_id: nombre,
  producto_nombre: nombre,
  litros_por_unidad: litros,
  costo_envase: envase,
  costo_tapa: tapa,
  costo_etiqueta: etiqueta,
  costo_pack: pack,
  velocidad_unid_hora: velocidad,
  operarios,
  rendimiento_packaging: rend,
  precio_venta: 0,
});

const COVEN: EntradaCosteo = {
  costo_insumos_gs: 3_142_529,
  rendimiento: 500,
  merma_proceso_pct: 0.08,
  operacion: [
    { categoria: "mano_obra", concepto: "Elaboración / cocimiento", monto_gs: 260_000 },
    { categoria: "mano_obra", concepto: "CIP / preparación / cierre", monto_gs: 52_000 },
    { categoria: "mano_obra", concepto: "Controles de fermentación", monto_gs: 39_000 },
    { categoria: "energia", concepto: "Electricidad del lote", monto_gs: 62_394.08 },
    { categoria: "otros", concepto: "Agua, CO₂, CIP y overhead", monto_gs: 736_620 },
  ],
  formatos: [
    fmt("Barril 20 L", 20, 0.99, 5000, 0, 500, 0, 8, 1),
    fmt("Lata 330 mL", 0.33, 0.98, 2500, 0, 1200, 400, 180, 2),
    fmt("Lata 500 mL", 0.5, 0.98, 2900, 0, 1300, 450, 160, 2),
    fmt("Botella 750 mL", 0.75, 0.98, 6000, 500, 1200, 500, 100, 2),
    fmt("Botella 1 L", 1, 0.98, 7650, 0, 1300, 500, 90, 2),
  ],
  parametros: {
    tarifa_mo_hora_gs: 13_000,
    margen_mayorista_pct: 0.4,
    margen_directo_pct: 0.45,
  },
};

console.log("\nLote de 500 L de COVEN — contra el Dashboard de la planilla");
const r = costearReceta(COVEN);

cerca("costo de operación del lote", r.costo_operacion_gs, 1_150_014.08);
cerca("costo base del lote", r.costo_lote_gs, 4_292_543.08);
cerca("volumen vendible", r.rendimiento_envasable, 460, 0.001);
cerca("costo por litro vendible", r.costo_por_litro_envasable, 9_331.62, 0.01);

const esperadas: Record<string, number> = {
  "Barril 20 L": 22,
  "Lata 330 mL": 1366,
  "Lata 500 mL": 901,
  "Botella 750 mL": 601,
  "Botella 1 L": 450,
};
for (const f of r.formatos) {
  ok(`unidades de ${f.producto_nombre}`, f.unidades === esperadas[f.producto_nombre],
     `esperaba ${esperadas[f.producto_nombre]}, dio ${f.unidades}`);
}

console.log("\nCoherencia interna");
cerca("la composición suma 1",
  r.composicion.insumos + r.composicion.mano_obra + r.composicion.energia + r.composicion.otros,
  1, 1e-9);
cerca("mano de obra = 351.000", r.operacion_por_categoria.mano_obra, 351_000);

for (const f of r.formatos) {
  cerca(`${f.producto_nombre}: el precio mayorista deja 40 %`,
    f.precio_mayorista! * (1 - 0.4), f.costo_unitario, 0.01);
  cerca(`${f.producto_nombre}: el precio directo deja 45 %`,
    f.precio_directo! * (1 - 0.45), f.costo_unitario, 0.01);
  cerca(`${f.producto_nombre}: el costo unitario es la suma de sus partes`,
    f.costo_cerveza + f.costo_packaging + f.costo_mo_envasado, f.costo_unitario, 0.01);
  ok(`${f.producto_nombre}: la merma de línea encarece el litro`,
    f.litros_consumidos_por_unidad >= f.litros_por_unidad);
}

console.log("\nLa cerveza envasada nunca puede costar menos que el lote");
const costoCervezaTotal = r.formatos.reduce(
  (acc, f) => Math.max(acc, f.costo_cerveza * f.unidades), 0);
ok("ningún formato reparte menos costo del que tiene el lote",
   costoCervezaTotal <= r.costo_lote_gs + 1,
   `lote ${Math.round(r.costo_lote_gs)}, repartido ${Math.round(costoCervezaTotal)}`);

console.log("\nCasos borde");
const vacio = costearReceta({
  costo_insumos_gs: 0, rendimiento: 0, merma_proceso_pct: 0,
  operacion: [], formatos: [],
  parametros: { tarifa_mo_hora_gs: 0, margen_mayorista_pct: 0.4, margen_directo_pct: 0.45 },
});
ok("receta vacía no divide por cero", vacio.costo_por_litro_envasable === null);
ok("receta vacía no inventa formatos", vacio.formatos.length === 0);

const mermaRota = costearReceta({ ...COVEN, merma_proceso_pct: 1.2 });
cerca("una merma imposible se ignora en vez de dar volumen negativo",
  mermaRota.rendimiento_envasable, 500, 0.001);

const sinVelocidad = costearReceta({
  ...COVEN,
  formatos: [{ ...COVEN.formatos[0], velocidad_unid_hora: null }],
});
cerca("sin velocidad de envasadora no se inventa mano de obra",
  sinVelocidad.formatos[0].costo_mo_envasado, 0, 0.001);

const sinMargen = costearReceta({
  ...COVEN,
  parametros: { ...COVEN.parametros, margen_mayorista_pct: 1 },
});
ok("un margen del 100 % no da un precio infinito",
   sinMargen.formatos[0].precio_mayorista === null);

const negativos = costearReceta({
  ...COVEN,
  operacion: [{ categoria: "otros", concepto: "basura", monto_gs: -999_999 }],
});
ok("un monto negativo no baja el costo del lote",
   negativos.costo_operacion_gs === 0);

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
