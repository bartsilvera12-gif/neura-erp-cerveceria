/**
 * PostgREST falso: intercepta `fetch` y traduce la petición a SQL.
 *
 * El código de producción habla con PostgREST a través de supabase-js. Acá no
 * hay PostgREST, así que se intercepta el `fetch` y se traduce la petición HTTP
 * que supabase-js ya armó. Se intercepta ahí y no en el builder para que la
 * serialización real de supabase-js (select, filtros, embeds, headers) quede
 * dentro de lo que se prueba, y para no tener que parchear módulos.
 *
 * FIDELIDAD: esto NO es PostgREST. Por eso las aserciones de la prueba no se
 * hacen sobre lo que devuelve, sino leyendo la base con SQL crudo después de
 * cada paso. Esto solo existe para que las funciones reales puedan correr.
 *
 * Cualquier cosa no implementada LANZA: un falso que inventa respuestas haría
 * pasar la prueba por el motivo equivocado.
 */
import type { Pool } from "pg";

type Fila = Record<string, unknown>;

export class ShimError extends Error {}

function ident(x: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x)) throw new ShimError(`Identificador inválido: ${x}`);
  return `"${x}"`;
}

/** Parte "a, b, rel(x, y), alias:col(z)" respetando los paréntesis. */
function partirSelect(sel: string): string[] {
  const out: string[] = [];
  let prof = 0, actual = "";
  for (const ch of sel) {
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) { out.push(actual.trim()); actual = ""; continue; }
    actual += ch;
  }
  if (actual.trim()) out.push(actual.trim());
  return out.filter(Boolean);
}

/** `in.("a","b")` → ["a","b"] */
function parsearListaIn(raw: string): string[] {
  const m = /^\((.*)\)$/.exec(raw);
  if (!m) throw new ShimError(`Lista in. mal formada: ${raw}`);
  if (m[1].trim() === "") return [];
  return m[1].split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
}

export type Registro = { metodo: string; tabla: string; sql: string };

export function instalarPostgrestFalso(pool: Pool, schema: string) {
  const registro: Registro[] = [];
  let fks: Array<{ tabla: string; columna: string; refTabla: string; refColumna: string }> | null = null;

  async function cargarFks() {
    if (fks) return fks;
    const { rows } = await pool.query<{ tabla: string; columna: string; reftabla: string; refcolumna: string }>(
      `SELECT tc.table_name AS tabla, kcu.column_name AS columna,
              ccu.table_name AS reftabla, ccu.column_name AS refcolumna
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [schema]
    );
    fks = rows.map((r) => ({ tabla: r.tabla, columna: r.columna, refTabla: r.reftabla, refColumna: r.refcolumna }));
    return fks;
  }

  async function proyeccion(tabla: string, select: string | null): Promise<string> {
    if (!select || select.trim() === "*") return "*";
    const sel: string[] = [];
    for (const p of partirSelect(select)) {
      // `select=*, rel(...)`: el `*` se califica con la tabla para no chocar
      // con las columnas de las subconsultas.
      if (p === "*") { sel.push(`${ident(tabla)}.*`); continue; }
      const m = /^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_]+)\(([^)]*)\)$/.exec(p);
      if (!m) { sel.push(ident(p)); continue; }
      const [, alias, destino, subcols] = m;
      const todas = await cargarFks();
      // `alias:columna_id(...)`: el destino ES la columna FK.
      let fk = todas.find((f) => f.tabla === tabla && f.columna === destino);
      // `tabla(...)`: buscar la FK de esta tabla que apunte a esa tabla.
      if (!fk) fk = todas.find((f) => f.tabla === tabla && f.refTabla === destino);
      if (!fk) throw new ShimError(`No encuentro la FK para el embed "${p}" en ${tabla}`);
      const clave = alias ?? destino;
      const inner = partirSelect(subcols).map((c) => `'${c}', r.${ident(c)}`).join(", ");
      sel.push(
        `(SELECT jsonb_build_object(${inner}) FROM ${ident(schema)}.${ident(fk.refTabla)} r
           WHERE r.${ident(fk.refColumna)} = ${ident(tabla)}.${ident(fk.columna)}) AS ${ident(clave)}`
      );
    }
    return sel.join(", ");
  }

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    if (!href.includes("/rest/v1/")) return originalFetch(input as RequestInfo, init);

    const url = new URL(href);
    const tabla = url.pathname.split("/rest/v1/")[1]?.split("/")[0] ?? "";
    if (!tabla) throw new ShimError(`No pude sacar la tabla de ${href}`);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const quiereObjeto = (headers.get("Accept") ?? "").includes("vnd.pgrst.object+json");
    const quiereFilas = (headers.get("Prefer") ?? "").includes("return=representation");

    let select: string | null = null;
    const orden: string[] = [];
    let limite: number | null = null;
    const wherePartes: string[] = [];
    const params: unknown[] = [];

    for (const [clave, valor] of url.searchParams.entries()) {
      if (clave === "select") { select = valor; continue; }
      if (clave === "columns") continue; // lo deducimos del body
      if (clave === "order") {
        for (const o of valor.split(",")) {
          const [col, dir] = o.split(".");
          orden.push(`${ident(col)} ${dir === "desc" ? "DESC" : "ASC"}`);
        }
        continue;
      }
      if (clave === "limit") { limite = Number(valor); continue; }
      if (clave === "offset" || clave === "on_conflict") throw new ShimError(`Parámetro no implementado: ${clave}`);

      // Filtro: col=<op>.<valor>
      const punto = valor.indexOf(".");
      if (punto < 0) throw new ShimError(`Filtro sin operador: ${clave}=${valor}`);
      const op = valor.slice(0, punto);
      const resto = valor.slice(punto + 1);
      if (op === "eq") { params.push(resto); wherePartes.push(`${ident(clave)} = $${params.length}`); }
      else if (op === "in") {
        const lista = parsearListaIn(resto);
        if (lista.length === 0) { wherePartes.push("false"); continue; }
        params.push(lista); wherePartes.push(`${ident(clave)} = ANY($${params.length})`);
      }
      else if (op === "is" && resto === "null") wherePartes.push(`${ident(clave)} IS NULL`);
      else if (op === "not" && resto === "is.null") wherePartes.push(`${ident(clave)} IS NOT NULL`);
      else throw new ShimError(`Operador no implementado: ${clave}=${valor}`);
    }

    const where = wherePartes.length ? ` WHERE ${wherePartes.join(" AND ")}` : "";
    const t = `${ident(schema)}.${ident(tabla)}`;
    const retorno = async () =>
      quiereFilas || quiereObjeto ? ` RETURNING ${await proyeccion(tabla, select)}` : "";

    let sql: string;
    if (metodo === "GET") {
      sql = `SELECT ${await proyeccion(tabla, select)} FROM ${t}${where}`;
      if (orden.length) sql += ` ORDER BY ${orden.join(", ")}`;
      if (limite != null) sql += ` LIMIT ${Number(limite)}`;
    } else if (metodo === "POST") {
      const body = JSON.parse(String(init?.body ?? "[]")) as Fila | Fila[];
      const filas = Array.isArray(body) ? body : [body];
      if (filas.length === 0) throw new ShimError("INSERT sin filas");
      const columnas = Object.keys(filas[0]);
      const values = filas.map((f) => {
        const ph = columnas.map((c) => { params.push(f[c] ?? null); return `$${params.length}`; });
        return `(${ph.join(", ")})`;
      });
      sql = `INSERT INTO ${t} (${columnas.map(ident).join(", ")}) VALUES ${values.join(", ")}${await retorno()}`;
    } else if (metodo === "PATCH") {
      const patch = JSON.parse(String(init?.body ?? "{}")) as Fila;
      const sets = Object.keys(patch).map((c) => { params.push(patch[c] ?? null); return `${ident(c)} = $${params.length}`; });
      if (!sets.length) throw new ShimError("PATCH sin columnas");
      // Los placeholders del SET van antes que los del WHERE: se reconstruye.
      const paramsOrdenados: unknown[] = [];
      const setsOk = Object.keys(patch).map((c) => { paramsOrdenados.push(patch[c] ?? null); return `${ident(c)} = $${paramsOrdenados.length}`; });
      const wherePartes2: string[] = [];
      for (const [clave, valor] of url.searchParams.entries()) {
        if (["select", "columns", "order", "limit"].includes(clave)) continue;
        const punto = valor.indexOf(".");
        const op = valor.slice(0, punto);
        const resto = valor.slice(punto + 1);
        if (op === "eq") { paramsOrdenados.push(resto); wherePartes2.push(`${ident(clave)} = $${paramsOrdenados.length}`); }
        else if (op === "in") {
          const lista = parsearListaIn(resto);
          if (lista.length === 0) { wherePartes2.push("false"); continue; }
          paramsOrdenados.push(lista); wherePartes2.push(`${ident(clave)} = ANY($${paramsOrdenados.length})`);
        }
        else throw new ShimError(`Operador no implementado en PATCH: ${clave}=${valor}`);
      }
      params.length = 0; params.push(...paramsOrdenados);
      sql = `UPDATE ${t} SET ${setsOk.join(", ")}${wherePartes2.length ? ` WHERE ${wherePartes2.join(" AND ")}` : ""}${await retorno()}`;
    } else if (metodo === "DELETE") {
      sql = `DELETE FROM ${t}${where}${await retorno()}`;
    } else {
      throw new ShimError(`Método no implementado: ${metodo}`);
    }

    registro.push({ metodo, tabla, sql: sql.replace(/\s+/g, " ").trim() });

    try {
      const res = await pool.query(sql, params);
      const filas = res.rows as Fila[];
      if (quiereObjeto) {
        if (filas.length !== 1) {
          return new Response(
            JSON.stringify({
              code: "PGRST116",
              details: `Results contain ${filas.length} rows, application/vnd.pgrst.object+json requires 1 row`,
              hint: null,
              message: "JSON object requested, multiple (or no) rows returned",
            }),
            { status: 406, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify(filas[0]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(filas), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({ code: "P0001", details: null, hint: null, message: msg }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }) as typeof fetch;

  return { registro, restaurar: () => { globalThis.fetch = originalFetch; } };
}
