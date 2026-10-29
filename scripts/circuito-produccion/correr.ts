/**
 * Circuito completo contra un Postgres local: lote → cocimiento → envasado →
 * remisión al Bar.
 *
 * Llama a las MISMAS funciones que usan las rutas de la app. Las aserciones se
 * hacen leyendo la base con SQL crudo, no con lo que devuelven esas funciones:
 * lo que se verifica es el estado que quedó guardado.
 */
import { Pool } from "pg";
import { instalarPostgrestFalso } from "./pgrest-shim";

const DB =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres@127.0.0.1:5440/postgres";
// La app lee estas al construir el cliente; apuntan a un puerto muerto a
// propósito: ninguna petición sale de acá, las intercepta el PostgREST falso.
process.env.NEURA_CLIENT_SCHEMA ??= "cerveceriaerp";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon.dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service.dummy";
process.env.SUPABASE_DB_URL ??= DB;
const EMPRESA = "0cbefe95-4007-402c-97de-70147f9d39bb";
const SUC_CERV = "37907a1a-5283-4b65-ae4e-4254924a1a82";
const SUC_BAR = "b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31";
const USUARIO = "11111111-2222-3333-4444-555555555555";
const RECETA = "d0000000-0000-4000-8000-000000000001";
const GRANEL_CERV = "b0000000-0000-4000-8000-000000000001";
const CHOP_CERV = "c0000000-0000-4000-8000-000000000001";
const FERMENTADOR = "e0000000-0000-4000-8000-000000000001";
const SCHEMA = "cerveceriaerp";

const pool = new Pool({ connectionString: DB, max: 5 });
const falso = instalarPostgrestFalso(pool, SCHEMA);

let fallos = 0;
function check(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) { fallos++; console.log(`   ✗ ${nombre}\n       esperado: ${JSON.stringify(esperado)}\n       obtenido: ${JSON.stringify(obtenido)}`); }
  else console.log(`   ✓ ${nombre} = ${JSON.stringify(obtenido)}`);
}
function checkTrue(nombre: string, cond: boolean, detalle = "") {
  if (!cond) { fallos++; console.log(`   ✗ ${nombre} ${detalle}`); }
  else console.log(`   ✓ ${nombre}`);
}

/** Lecturas de verificación: SQL crudo, sin pasar por el código probado. */
async function stock(productoId: string): Promise<{ stock: number; costo: number }> {
  const { rows } = await pool.query(
    `SELECT stock_actual::float8 AS s, costo_promedio::float8 AS c FROM cerveceriaerp.productos WHERE id=$1`, [productoId]);
  return { stock: rows[0].s, costo: rows[0].c };
}
async function stockPorSku(sku: string, sucursalId: string) {
  const { rows } = await pool.query(
    `SELECT stock_actual::float8 AS s, costo_promedio::float8 AS c FROM cerveceriaerp.productos
      WHERE sku=$1 AND sucursal_id=$2`, [sku, sucursalId]);
  return { stock: rows[0].s, costo: rows[0].c };
}
async function movimientos(origen: string) {
  const { rows } = await pool.query(
    `SELECT m.tipo, m.cantidad::float8 AS cantidad, p.sku, s.codigo AS sucursal
       FROM cerveceriaerp.movimientos_inventario m
       JOIN cerveceriaerp.productos p ON p.id = m.producto_id
       JOIN cerveceriaerp.sucursales s ON s.id = m.sucursal_id
      WHERE m.origen=$1 ORDER BY p.sku, m.tipo`, [origen]);
  return rows;
}

/** Deja la base como el seed: la prueba tiene que poder repetirse. */
async function reiniciar() {
  await pool.query(`
    TRUNCATE cerveceriaerp.transferencias_inventario,
             cerveceriaerp.produccion_lotes,
             cerveceriaerp.producciones,
             cerveceriaerp.movimientos_inventario RESTART IDENTITY CASCADE;
    UPDATE cerveceriaerp.productos SET stock_actual = 250, costo_promedio = 10000 WHERE sku = 'MP-PILSEN';
    UPDATE cerveceriaerp.productos SET stock_actual = 5000, costo_promedio = 50    WHERE sku = 'MP-CASCADE';
    UPDATE cerveceriaerp.productos SET stock_actual = 0,   costo_promedio = 0      WHERE sku IN ('CV-BL-GRANEL','CV-BL-CHOP500');
  `);
}

async function main() {
  await reiniciar();
  const { crearProduccionPg } = await import("@/lib/produccion/crear-produccion-pg");
  const { insertLote, getLote, updateLote, insertEtapa, listEtapas } = await import("@/lib/produccion/lotes-pg");
  const { envasarLote, VolumenInsuficienteError } = await import("@/lib/produccion/envasado-pg");
  const {
    crearTransferencia, aprobarTransferencia, despacharTransferencia, recibirTransferencia, TransferenciaError,
  } = await import("@/lib/transferencias/server/transferencias-pg");
  const { createServiceRoleClientWithDbSchema } = await import("@/lib/supabase/empresa-data-schema");
  const sb = createServiceRoleClientWithDbSchema(SCHEMA);

  // ───────────────────────────────────────────────────────────── PASO 1
  console.log("\n1. PLANIFICAR EL LOTE");
  const lote = await insertLote(sb, EMPRESA, SUC_CERV, {
    codigo: "L-2026-001",
    receta_id: RECETA,
    producto_granel_id: GRANEL_CERV,
    fermentador_id: FERMENTADOR,
    volumen_planificado: 500,
    fecha_fin_estimada: null,
    responsable_usuario_id: USUARIO,
    responsable_nombre: "Administrador",
    observaciones: null,
  });
  const { rows: l0 } = await pool.query(`SELECT codigo, estado, volumen_envasado::float8 AS ve FROM cerveceriaerp.produccion_lotes WHERE id=$1`, [lote.id]);
  check("lote creado en estado", l0[0].estado, "planificado");
  check("volumen envasado inicial", l0[0].ve, 0);

  // ───────────────────────────────────────────────────────────── PASO 2
  console.log("\n2. COCIMIENTO (knockout 480 L sobre una receta de 500 L)");
  console.log("   insumos esperados: malta 480*100/500 = 96 KG · lúpulo 480*1000/500 = 960 G");
  const loteFull = await getLote(sb, EMPRESA, lote.id);
  if (!loteFull) throw new Error("getLote devolvió null");
  check("getLote resolvió el embed del fermentador", loteFull.fermentador_codigo, "F1");
  check("getLote resolvió el embed del granel", loteFull.producto_granel_nombre, "COVEN BLONDE ALE A GRANEL");

  const prod = await crearProduccionPg({
    schema: SCHEMA, empresaId: EMPRESA, recetaId: RECETA, cantidadFabricar: 480,
    observaciones: `Cocimiento del lote ${loteFull.codigo}`,
    usuarioId: USUARIO, usuarioNombre: "Administrador",
  });
  await updateLote(sb, EMPRESA, lote.id, {
    estado: "cocimiento", volumen_obtenido: 480, produccion_id: prod.produccion_id,
    fecha_inicio: new Date().toISOString(),
  });
  await insertEtapa(sb, EMPRESA, lote.id, "cocimiento", { id: USUARIO, nombre: "Administrador" }, "Knockout: 480 L");

  check("malta: 250 − 96", (await stock("a0000000-0000-4000-8000-000000000001")).stock, 154);
  check("lúpulo: 5000 − 960", (await stock("a0000000-0000-4000-8000-000000000002")).stock, 4040);
  const granel = await stock(GRANEL_CERV);
  check("granel producido", granel.stock, 480);
  check("costo del granel (1.008.000 / 480)", granel.costo, 2100);
  const { rows: pr } = await pool.query(`SELECT costo_total::float8 AS t, costo_unitario::float8 AS u FROM cerveceriaerp.producciones WHERE id=$1`, [prod.produccion_id]);
  check("costo total (96×10.000 + 960×50)", pr[0].t, 1008000);
  check("costo por litro", pr[0].u, 2100);
  const movsProd = await movimientos("produccion");
  check("movimientos de producción", movsProd.map((m) => `${m.sucursal}/${m.sku}/${m.tipo}/${m.cantidad}`),
    ["CERVECERIA/CV-BL-GRANEL/ENTRADA/480", "CERVECERIA/MP-CASCADE/SALIDA/960", "CERVECERIA/MP-PILSEN/SALIDA/96"]);

  // ───────────────────────────────────────────────────────────── PASO 3
  console.log("\n3. ETAPAS HASTA ENVASADO");
  for (const etapa of ["fermentacion", "maduracion", "carbonatacion", "envasado"]) {
    await updateLote(sb, EMPRESA, lote.id, { estado: etapa });
    await insertEtapa(sb, EMPRESA, lote.id, etapa, { id: USUARIO, nombre: "Administrador" }, null);
  }
  const etapas = await listEtapas(sb, lote.id);
  check("historial de etapas", etapas.map((e) => e.etapa),
    ["cocimiento", "fermentacion", "maduracion", "carbonatacion", "envasado"]);

  // ───────────────────────────────────────────────────────────── PASO 4
  console.log("\n4. ENVASADO (800 chops de 500 ml = 400 L)");
  const env = await envasarLote({
    sb, empresaId: EMPRESA, loteId: lote.id, productoId: CHOP_CERV, cantidad: 800,
    usuarioId: USUARIO, usuarioNombre: "Administrador",
  });
  check("litros que consumió el envasado", env.litros, 400);
  check("granel: 480 − 400", (await stock(GRANEL_CERV)).stock, 80);
  const chop = await stock(CHOP_CERV);
  check("chops dados de alta", chop.stock, 800);
  check("costo del chop (2.100 × 0,5 L)", chop.costo, 1050);
  const { rows: l1 } = await pool.query(`SELECT volumen_envasado::float8 AS ve FROM cerveceriaerp.produccion_lotes WHERE id=$1`, [lote.id]);
  check("volumen_envasado recalculado por el trigger", l1[0].ve, 400);
  check("merma del lote (480 − 400)", env.merma_litros, 80);

  console.log("\n4b. GUARDA: envasar más de lo que queda");
  let bloqueo = "no bloqueó";
  try {
    await envasarLote({ sb, empresaId: EMPRESA, loteId: lote.id, productoId: CHOP_CERV, cantidad: 200 });
  } catch (e) { bloqueo = e instanceof VolumenInsuficienteError ? "VolumenInsuficienteError" : `otro: ${e}`; }
  check("200 chops más (100 L) sobre 80 L disponibles", bloqueo, "VolumenInsuficienteError");
  check("el stock no se movió", (await stock(GRANEL_CERV)).stock, 80);
  check("los chops no se movieron", (await stock(CHOP_CERV)).stock, 800);

  // ───────────────────────────────────────────────────────────── PASO 5
  console.log("\n5. REMISIÓN AL BAR (60 L de granel + 200 chops)");
  const trf = await crearTransferencia({
    schemaRaw: SCHEMA, empresaId: EMPRESA,
    sucursalOrigenId: SUC_CERV, sucursalDestinoId: SUC_BAR,
    items: [
      { producto_id: GRANEL_CERV, cantidad_solicitada: 60 },
      { producto_id: CHOP_CERV, cantidad_solicitada: 200 },
    ],
    observacion: "Reposición del bar", usuarioId: USUARIO,
  });
  console.log(`   transferencia ${trf.numero}`);

  console.log("\n5b. GUARDA: despachar sin aprobar");
  let bloqueo2 = "no bloqueó";
  try {
    await despacharTransferencia({ schemaRaw: SCHEMA, empresaId: EMPRESA, transferenciaId: trf.id, usuarioId: USUARIO, usuarioNombre: "Administrador" });
  } catch (e) { bloqueo2 = e instanceof TransferenciaError ? `TransferenciaError(${e.status})` : `otro: ${e}`; }
  checkTrue("despachar una transferencia pendiente se rechaza", bloqueo2.startsWith("TransferenciaError"), bloqueo2);

  const { rows: items } = await pool.query(
    `SELECT i.id, i.sku_snapshot, i.cantidad_solicitada::float8 AS q FROM cerveceriaerp.transferencias_inventario_items i
      WHERE i.transferencia_id=$1 ORDER BY i.sku_snapshot`, [trf.id]);
  check("items de la solicitud", items.map((i) => `${i.sku_snapshot}/${i.q}`), ["CV-BL-CHOP500/200", "CV-BL-GRANEL/60"]);

  await aprobarTransferencia({
    schemaRaw: SCHEMA, empresaId: EMPRESA, transferenciaId: trf.id,
    aprobaciones: items.map((i) => ({ item_id: i.id, cantidad_aprobada: i.q })),
    usuarioId: USUARIO,
  });
  await despacharTransferencia({ schemaRaw: SCHEMA, empresaId: EMPRESA, transferenciaId: trf.id, usuarioId: USUARIO, usuarioNombre: "Administrador" });

  console.log("   despachada: el stock sale de la Cervecería");
  check("granel en Cervecería: 80 − 60", (await stockPorSku("CV-BL-GRANEL", SUC_CERV)).stock, 20);
  check("chops en Cervecería: 800 − 200", (await stockPorSku("CV-BL-CHOP500", SUC_CERV)).stock, 600);
  check("granel en el Bar (todavía en tránsito)", (await stockPorSku("CV-BL-GRANEL", SUC_BAR)).stock, 0);

  await recibirTransferencia({ schemaRaw: SCHEMA, empresaId: EMPRESA, transferenciaId: trf.id, usuarioId: USUARIO, usuarioNombre: "Administrador" });

  console.log("   recibida: el stock entra al Bar");
  const granelBar = await stockPorSku("CV-BL-GRANEL", SUC_BAR);
  const chopBar = await stockPorSku("CV-BL-CHOP500", SUC_BAR);
  check("granel en el Bar", granelBar.stock, 60);
  check("chops en el Bar", chopBar.stock, 200);
  check("el Bar hereda el costo del chop", chopBar.costo, 1050);
  check("el Bar hereda el costo del granel", granelBar.costo, 2100);

  const { rows: est } = await pool.query(`SELECT estado FROM cerveceriaerp.transferencias_inventario WHERE id=$1`, [trf.id]);
  check("estado final de la transferencia", est[0].estado, "recibida");
  check("movimientos de salida", (await movimientos("transferencia_salida")).map((m) => `${m.sucursal}/${m.sku}/${m.cantidad}`),
    ["CERVECERIA/CV-BL-CHOP500/200", "CERVECERIA/CV-BL-GRANEL/60"]);
  check("movimientos de entrada", (await movimientos("transferencia_entrada")).map((m) => `${m.sucursal}/${m.sku}/${m.cantidad}`),
    ["BAR/CV-BL-CHOP500/200", "BAR/CV-BL-GRANEL/60"]);

  // ───────────────────────────────────────────────────────────── CIERRE
  console.log("\n6. CUADRE FINAL");
  const { rows: cuadre } = await pool.query(
    `SELECT s.codigo AS suc, p.sku, p.stock_actual::float8 AS stock
       FROM cerveceriaerp.productos p JOIN cerveceriaerp.sucursales s ON s.id=p.sucursal_id
      WHERE p.sku LIKE 'CV-%' ORDER BY p.sku, s.codigo`);
  for (const r of cuadre) console.log(`   ${r.suc.padEnd(11)} ${r.sku.padEnd(15)} ${r.stock}`);
  const totalGranel = cuadre.filter((r) => r.sku === "CV-BL-GRANEL").reduce((a, r) => a + r.stock, 0);
  const totalChops = cuadre.filter((r) => r.sku === "CV-BL-CHOP500").reduce((a, r) => a + r.stock, 0);
  check("litros de granel que quedan (480 producidos − 400 envasados)", totalGranel, 80);
  check("chops en total (sin pérdidas entre sucursales)", totalChops, 800);
  check("litros totales = granel + chops×0,5 = 80 + 400", totalGranel + totalChops * 0.5, 480);

  console.log(fallos === 0 ? "\n=== CIRCUITO OK: todas las comprobaciones pasaron ===" : `\n=== ${fallos} COMPROBACIONES FALLARON ===`);
  console.log(`(${falso.registro.length} consultas PostgREST traducidas a SQL)`);
  await pool.end();
  falso.restaurar();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\nERROR:", e); await pool.end(); process.exit(1); });
