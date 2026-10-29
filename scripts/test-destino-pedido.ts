/**
 * Tests de `resolverDestinoPedido`.
 *
 * Esta función reemplazó dos búsquedas por código a mano que rompían "Crear
 * pedido" desde Presupuestos con "Tipo de proyecto 'pedido' no configurado".
 * El caso que fallaba en producción es el primero de acá: el tablero cargado
 * con la columna inicial llamada `pendiente` en vez de `nuevo`.
 *
 * Correr con: npm run test:destino-pedido
 */
import { resolverDestinoPedido } from "../src/lib/proyectos/server/destino-pedido";

type Fila = Record<string, unknown>;

/** Cliente de mentira: guarda las tablas en memoria y aplica los .eq() */
function clienteFalso(tablas: Record<string, Fila[]>) {
  const upserts: Fila[] = [];
  const sb = {
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq(col: string, val: unknown) {
          filas = filas.filter((f) => f[col] === val);
          return q;
        },
        maybeSingle: async () => ({ data: filas[0] ?? null, error: null }),
        upsert(fila: Fila) {
          upserts.push(fila);
          const creada = { ...fila, id: "creado-" + upserts.length };
          (tablas[tabla] ??= []).push(creada);
          filas = [creada];
          return q;
        },
      };
      return q;
    },
  };
  return { sb, upserts, tablas };
}

let fallos = 0, corridas = 0;
function ok(nombre: string, cond: boolean, detalle = "") {
  corridas++;
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${detalle ? " — " + detalle : ""}`); }
}
async function cae(nombre: string, fn: () => Promise<unknown>, contiene: string) {
  corridas++;
  try {
    await fn();
    fallos++; console.log(`  FALLA ${nombre} — no tiró error`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(contiene)) console.log(`  ok   ${nombre}`);
    else { fallos++; console.log(`  FALLA ${nombre} — el error dice "${msg}"`); }
  }
}

const E = "empresa-1";
const TIPO_PEDIDO = { id: "t-ped", empresa_id: E, codigo: "pedido", activo: true };

async function correr() {
  console.log("\nEl caso que rompía en producción");
  {
    // Tablero cargado por el script 11: la inicial se llama `pendiente`.
    const { sb } = clienteFalso({
      proyecto_tipos: [TIPO_PEDIDO],
      proyecto_estados: [
        { id: "e-pend", empresa_id: E, codigo: "pendiente", activo: true, es_estado_inicial: true, sort_order: 10 },
        { id: "e-prep", empresa_id: E, codigo: "preparacion", activo: true, es_estado_inicial: false, sort_order: 20 },
      ],
    });
    const r = await resolverDestinoPedido(sb as never, E);
    ok("usa la columna marcada como inicial aunque no se llame 'nuevo'", r.estadoId === "e-pend",
       `dio ${r.estadoId}`);
    ok("resuelve el tipo pedido", r.tipoId === "t-ped");
  }

  console.log("\nCompatibilidad con una instalación vieja");
  {
    // Nadie marcó la inicial, pero existe el código 'nuevo' de siempre.
    const { sb } = clienteFalso({
      proyecto_tipos: [TIPO_PEDIDO],
      proyecto_estados: [
        { id: "e-nuevo", empresa_id: E, codigo: "nuevo", activo: true, es_estado_inicial: false },
      ],
    });
    const r = await resolverDestinoPedido(sb as never, E);
    ok("cae al código 'nuevo' si nadie marcó la inicial", r.estadoId === "e-nuevo");
  }

  console.log("\nEl tipo 'pedido' se crea solo");
  {
    const falso = clienteFalso({
      proyecto_tipos: [],
      proyecto_estados: [{ id: "e1", empresa_id: E, codigo: "pendiente", activo: true, es_estado_inicial: true }],
    });
    const r = await resolverDestinoPedido(falso.sb as never, E);
    ok("no falla cuando el tipo no existe", typeof r.tipoId === "string" && r.tipoId.length > 0);
    ok("lo crea con el código correcto", falso.upserts[0]?.codigo === "pedido",
       JSON.stringify(falso.upserts[0] ?? null));
    ok("y lo crea activo", falso.upserts[0]?.activo === true);
  }

  console.log("\nLo que sí tiene que avisar");
  {
    // Sin columnas no hay dónde poner el pedido, y eso lo decide el cliente.
    const { sb } = clienteFalso({ proyecto_tipos: [TIPO_PEDIDO], proyecto_estados: [] });
    await cae("sin columnas en el tablero, dice dónde se arregla",
      () => resolverDestinoPedido(sb as never, E), "Configuración → Proyectos");
  }
  {
    // Un estado inicial de OTRA empresa no sirve.
    const { sb } = clienteFalso({
      proyecto_tipos: [TIPO_PEDIDO],
      proyecto_estados: [{ id: "x", empresa_id: "otra", codigo: "nuevo", activo: true, es_estado_inicial: true }],
    });
    await cae("no toma el estado de otra empresa",
      () => resolverDestinoPedido(sb as never, E), "no tiene columnas");
  }
  {
    // Una columna desactivada tampoco.
    const { sb } = clienteFalso({
      proyecto_tipos: [TIPO_PEDIDO],
      proyecto_estados: [{ id: "x", empresa_id: E, codigo: "nuevo", activo: false, es_estado_inicial: true }],
    });
    await cae("ignora las columnas desactivadas",
      () => resolverDestinoPedido(sb as never, E), "no tiene columnas");
  }

  console.log(`\n${corridas - fallos}/${corridas} comprobaciones pasaron.`);
  if (fallos > 0) process.exit(1);

}

correr();
