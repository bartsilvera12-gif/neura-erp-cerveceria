/**
 * Tests de las mediciones de fermentación (`densidad.ts`).
 *
 * Lo que importa: que el alcohol salga de las densidades medidas y que una
 * medición mal cargada se rechace antes de guardarse. Un 1048 escrito donde va
 * 1.048 no es un dato raro, es el error de tipeo de todos los días.
 *
 * Correr con: npm run test:densidad
 */
import {
  abvEstimado,
  atenuacion,
  ogFg,
  validarMedicion,
} from "../src/lib/produccion/densidad";

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}

console.log("\nAlcohol estimado");
{
  // Blonde Ale típica: 1.048 → 1.010 ≈ 5%
  ok("1.048 a 1.010 da 4.99", abvEstimado(1.048, 1.01) === 4.99, String(abvEstimado(1.048, 1.01)));
  ok("sin fermentar da 0", abvEstimado(1.05, 1.05) === 0);
  ok("falta la final", abvEstimado(1.048, null) === null);
  ok("falta la inicial", abvEstimado(null, 1.01) === null);
  // Una final MAYOR que la inicial es una medición mal cargada, no alcohol
  // negativo: mostrar un número ahí es peor que no mostrar nada.
  ok("final mayor que la inicial da null", abvEstimado(1.01, 1.048) === null);
  ok("texto no rompe", abvEstimado(Number("x"), 1.01) === null);
}

console.log("\nAtenuación");
{
  ok("1.048 a 1.010 atenúa 79.2%", atenuacion(1.048, 1.01) === 79.2, String(atenuacion(1.048, 1.01)));
  ok("sin fermentar atenúa 0", atenuacion(1.048, 1.048) === 0);
  ok("agua (og 1.000) da null", atenuacion(1, 1) === null);
  ok("final mayor da null", atenuacion(1.01, 1.048) === null);
}

console.log("\nOG y FG de una lista de mediciones");
{
  const lista = [
    { densidad: 1.048 },
    { densidad: null },
    { densidad: 1.022 },
    { densidad: 1.01 },
  ];
  const { og, fg } = ogFg(lista);
  ok("la primera con densidad es la OG", og === 1.048, String(og));
  ok("la última con densidad es la FG", fg === 1.01, String(fg));
  ok("lista vacía", JSON.stringify(ogFg([])) === '{"og":null,"fg":null}');
  // Con una sola medición hay OG pero no FG: repetirla daría 0% de alcohol
  // cuando en realidad la fermentación recién arranca.
  const sola = ogFg([{ densidad: 1.048 }]);
  ok("una sola medición no inventa FG", sola.og === 1.048 && sola.fg === null, JSON.stringify(sola));
  ok("y entonces no hay ABV", abvEstimado(sola.og, sola.fg) === null);
  ok("mediciones sin densidad", JSON.stringify(ogFg([{ densidad: null }])) === '{"og":null,"fg":null}');
}

console.log("\nValidación: lo que no se guarda");
{
  ok("vacía se rechaza", validarMedicion({}).ok === false);
  ok("todo en blanco se rechaza", validarMedicion({ densidad: "", temperatura: "", ph: "" }).ok === false);
  const mil = validarMedicion({ densidad: 1048 });
  ok("1048 se rechaza", mil.ok === false);
  ok("y avisa del punto", mil.ok === false && mil.error.includes("1048"), JSON.stringify(mil));
  ok("densidad 0.5 se rechaza", validarMedicion({ densidad: 0.5 }).ok === false);
  ok("temperatura 500 se rechaza", validarMedicion({ temperatura: 500 }).ok === false);
  ok("pH 14 se rechaza", validarMedicion({ ph: 14 }).ok === false);
  ok("texto se rechaza", validarMedicion({ densidad: "mil" }).ok === false);
}

console.log("\nValidación: lo que sí");
{
  const r = validarMedicion({ densidad: "1,048", temperatura: "18,5", ph: "4,4" });
  ok("acepta coma decimal", r.ok === true, JSON.stringify(r));
  if (r.ok) {
    ok("convierte la coma", r.medicion.densidad === 1.048 && r.medicion.temperatura === 18.5);
    ok("pH también", r.medicion.ph === 4.4);
  }
  const soloTemp = validarMedicion({ temperatura: 18 });
  ok("sólo temperatura alcanza", soloTemp.ok === true);
  ok("y el resto queda en null", soloTemp.ok === true && soloTemp.medicion.densidad === null);
  ok("temperatura bajo cero (cámara) se acepta", validarMedicion({ temperatura: -2 }).ok === true);
}

console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
if (fallos > 0) process.exit(1);
