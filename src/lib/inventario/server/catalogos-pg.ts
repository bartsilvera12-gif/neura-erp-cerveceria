/**
 * PG directo para catalogos de Inventario:
 *   - categorias_productos
 *   - inventario_ubicaciones
 *   - producto_categorias (puente)
 *   - inventario_stock_ubicacion (stock por ubicacion)
 *
 * Multi-tenant: schema validado con assertAllowedChatDataSchema, tablas
 * citadas con quoteSchemaTable, valores via placeholders $N.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { andSucursales } from "@/lib/sucursales/sql";
import type { Pool } from "pg";

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}

// ─── Categorias de productos ──────────────────────────────────────────────

export interface CategoriaProductoRow {
  id: string;
  empresa_id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Auto-sync: importa a categorias_productos cualquier rubro de proveedor
 * (proveedor_categorias) activo que no exista todavia, comparando por
 * lower(trim(nombre)). Idempotente y protegido por UNIQUE INDEX
 * uq_categorias_productos_empresa_nombre.
 *
 * Esto unifica los dos catalogos desde el punto de vista del usuario:
 * lo que cargo como rubro del proveedor aparece tambien como categoria
 * de producto, sin obligar al usuario a duplicar la carga.
 */
async function seedCategoriasFromProveedor(schema: string, empresaId: string): Promise<void> {
  const tProd = quoteSchemaTable(schema, "categorias_productos");
  const tProv = quoteSchemaTable(schema, "proveedor_categorias");
  try {
    await pool().query(
      `INSERT INTO ${tProd} (empresa_id, nombre, activo)
       SELECT pc.empresa_id, pc.nombre, true
         FROM ${tProv} pc
        WHERE pc.empresa_id = $1::uuid
          AND pc.activo = true
          AND NOT EXISTS (
            SELECT 1 FROM ${tProd} cp
             WHERE cp.empresa_id = pc.empresa_id
               AND lower(trim(cp.nombre)) = lower(trim(pc.nombre))
          )`,
      [empresaId]
    );
  } catch (err) {
    // Si proveedor_categorias no existe en este schema, ignorar.
    const msg = err instanceof Error ? err.message : "";
    if (!/proveedor_categorias.*does not exist|relation .* does not exist/i.test(msg)) {
      console.error("[catalogos-pg] seedCategoriasFromProveedor", { schema, message: msg });
    }
  }
}

export async function listCategoriasProducto(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivas?: boolean } = {}
): Promise<CategoriaProductoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const p = pool();

  // Sync una sola vez por empresa: si ya hay rows, no corremos el INSERT.
  // Evita gastar conexiones del pool (limite 15 en session mode) en cada GET.
  const probe = await p.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
    [empresaId]
  );
  if (Number(probe.rows[0]?.c ?? 0) === 0) {
    await seedCategoriasFromProveedor(schema, empresaId);
  }

  const where = ["empresa_id = $1::uuid"];
  if (opts.soloActivas !== false) where.push("activo = true");
  const { rows } = await p.query<CategoriaProductoRow>(
    `SELECT id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at
       FROM ${t}
      WHERE ${where.join(" AND ")}
      ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

export async function insertCategoriaProducto(
  schemaRaw: string,
  empresaId: string,
  d: { nombre: string; codigo?: string | null; descripcion?: string | null; parent_id?: string | null; activo?: boolean }
): Promise<CategoriaProductoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const { rows } = await pool().query<CategoriaProductoRow>(
    `INSERT INTO ${t} (empresa_id, nombre, codigo, descripcion, parent_id, activo)
     VALUES ($1::uuid, $2, $3, $4, $5, COALESCE($6::boolean, true))
     RETURNING id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at`,
    [
      empresaId,
      d.nombre.trim(),
      d.codigo?.trim() || null,
      d.descripcion?.trim() || null,
      d.parent_id || null,
      d.activo ?? true,
    ]
  );
  return rows[0];
}

export async function updateCategoriaProducto(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<{ nombre: string; codigo: string | null; descripcion: string | null; parent_id: string | null; activo: boolean }>
): Promise<CategoriaProductoRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "categorias_productos");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(d.nombre.trim()); }
  if (d.codigo !== undefined) { sets.push(`codigo = $${i++}`); params.push(d.codigo?.trim() || null); }
  if (d.descripcion !== undefined) { sets.push(`descripcion = $${i++}`); params.push(d.descripcion?.trim() || null); }
  if (d.parent_id !== undefined) { sets.push(`parent_id = $${i++}`); params.push(d.parent_id || null); }
  if (d.activo !== undefined) { sets.push(`activo = $${i++}::boolean`); params.push(d.activo); }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<CategoriaProductoRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
      RETURNING id, empresa_id, nombre, codigo, descripcion, parent_id, activo, created_at, updated_at`,
    params
  );
  return rows[0] ?? null;
}

// ─── Ubicaciones ──────────────────────────────────────────────────────────

const TIPOS_UBICACION = ["deposito", "salon", "pasillo", "gondola", "estante", "zona", "otro"] as const;
export type TipoUbicacion = typeof TIPOS_UBICACION[number];
function normTipo(t: unknown): TipoUbicacion {
  return TIPOS_UBICACION.includes(t as TipoUbicacion) ? (t as TipoUbicacion) : "deposito";
}

export interface UbicacionRow {
  /** Agregados de stock (ver `listUbicaciones`). Ausentes en inserts/updates. */
  productos?: number;
  unidades?: number;
  valorizado?: number;
  productos_sin_stock?: number;
  id: string;
  empresa_id: string;
  nombre: string;
  codigo: string | null;
  tipo: TipoUbicacion;
  parent_id: string | null;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Ubicaciones con lo que tienen guardado.
 *
 * El stock no vive por depósito: cada producto apunta a una
 * `ubicacion_principal_id`, así que lo que hay en un depósito es la suma de los
 * productos asignados a él. Se devuelve además la valorización (al costo
 * promedio) y cuántos productos están sin stock, que es lo que se mira antes de
 * salir a reponer.
 *
 * `sucursalIds` acota la suma a las sucursales que el usuario está viendo: las
 * ubicaciones son de la empresa, pero los productos son de una sucursal, y sin
 * el filtro la Cervecería y el Bar aparecían sumados en el mismo depósito.
 */
export async function listUbicaciones(
  schemaRaw: string,
  empresaId: string,
  opts: { soloActivas?: boolean; sucursalIds?: readonly string[] } = {}
): Promise<UbicacionRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const tProd = quoteSchemaTable(schema, "productos");
  const where = ["u.empresa_id = $1::uuid"];
  if (opts.soloActivas !== false) where.push("u.activo = true");
  const filtroSucursal =
    opts.sucursalIds && opts.sucursalIds.length > 0 ? andSucursales(opts.sucursalIds, "p.") : "";
  const { rows } = await pool().query<UbicacionRow>(
    `SELECT u.id, u.empresa_id, u.nombre, u.codigo, u.tipo, u.parent_id, u.descripcion,
            u.activo, u.created_at, u.updated_at,
            COALESCE(s.productos, 0)        AS productos,
            COALESCE(s.unidades, 0)         AS unidades,
            COALESCE(s.valorizado, 0)       AS valorizado,
            COALESCE(s.productos_sin_stock, 0) AS productos_sin_stock
       FROM ${t} u
       LEFT JOIN (
         SELECT p.ubicacion_principal_id AS ubicacion_id,
                COUNT(*)                                   AS productos,
                SUM(COALESCE(p.stock_actual, 0))           AS unidades,
                SUM(COALESCE(p.stock_actual, 0) * COALESCE(p.costo_promedio, 0)) AS valorizado,
                COUNT(*) FILTER (WHERE COALESCE(p.stock_actual, 0) <= 0)         AS productos_sin_stock
           FROM ${tProd} p
          WHERE p.empresa_id = $1::uuid
            AND p.activo = true
            AND p.ubicacion_principal_id IS NOT NULL${filtroSucursal}
          GROUP BY p.ubicacion_principal_id
       ) s ON s.ubicacion_id = u.id
      WHERE ${where.join(" AND ")}
      ORDER BY u.nombre`,
    [empresaId]
  );
  return rows.map((r) => ({
    ...r,
    productos: Number(r.productos ?? 0),
    unidades: Number(r.unidades ?? 0),
    valorizado: Number(r.valorizado ?? 0),
    productos_sin_stock: Number(r.productos_sin_stock ?? 0),
  }));
}

export async function insertUbicacion(
  schemaRaw: string,
  empresaId: string,
  d: { nombre: string; codigo?: string | null; tipo?: string; parent_id?: string | null; descripcion?: string | null; activo?: boolean }
): Promise<UbicacionRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const { rows } = await pool().query<UbicacionRow>(
    `INSERT INTO ${t} (empresa_id, nombre, codigo, tipo, parent_id, descripcion, activo)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::boolean, true))
     RETURNING id, empresa_id, nombre, codigo, tipo, parent_id, descripcion, activo, created_at, updated_at`,
    [
      empresaId,
      d.nombre.trim(),
      d.codigo?.trim() || null,
      normTipo(d.tipo),
      d.parent_id || null,
      d.descripcion?.trim() || null,
      d.activo ?? true,
    ]
  );
  return rows[0];
}

export async function updateUbicacion(
  schemaRaw: string,
  empresaId: string,
  id: string,
  d: Partial<{ nombre: string; codigo: string | null; tipo: string; parent_id: string | null; descripcion: string | null; activo: boolean }>
): Promise<UbicacionRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_ubicaciones");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(d.nombre.trim()); }
  if (d.codigo !== undefined) { sets.push(`codigo = $${i++}`); params.push(d.codigo?.trim() || null); }
  if (d.tipo !== undefined) { sets.push(`tipo = $${i++}`); params.push(normTipo(d.tipo)); }
  if (d.parent_id !== undefined) { sets.push(`parent_id = $${i++}`); params.push(d.parent_id || null); }
  if (d.descripcion !== undefined) { sets.push(`descripcion = $${i++}`); params.push(d.descripcion?.trim() || null); }
  if (d.activo !== undefined) { sets.push(`activo = $${i++}::boolean`); params.push(d.activo); }
  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rows } = await pool().query<UbicacionRow>(
    `UPDATE ${t} SET ${sets.join(", ")}
      WHERE id = $${i++}::uuid AND empresa_id = $${i}::uuid
      RETURNING id, empresa_id, nombre, codigo, tipo, parent_id, descripcion, activo, created_at, updated_at`,
    params
  );
  return rows[0] ?? null;
}

// ─── Relacion producto<->categoria principal ────────────────────────────

/**
 * Sincroniza la categoria principal: limpia es_principal previo y reinserta
 * (o actualiza) la fila marcada. Tambien asegura que el producto figure
 * en producto_categorias (puente N:N) cuando la categoria viene seleccionada.
 */
export async function setCategoriaPrincipal(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  categoriaId: string | null
): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "producto_categorias");
  const p = pool();
  // 1) Limpiar es_principal previo
  await p.query(
    `UPDATE ${t} SET es_principal = false
      WHERE empresa_id = $1::uuid AND producto_id = $2::uuid AND es_principal = true`,
    [empresaId, productoId]
  );
  if (!categoriaId) return;
  // 2) Upsert con es_principal=true
  await p.query(
    `INSERT INTO ${t} (empresa_id, producto_id, categoria_id, es_principal)
     VALUES ($1::uuid, $2::uuid, $3::uuid, true)
     ON CONFLICT (empresa_id, producto_id, categoria_id)
     DO UPDATE SET es_principal = true`,
    [empresaId, productoId, categoriaId]
  );
}

// ─── Stock por ubicacion (inicial al crear producto) ────────────────────

export async function setStockUbicacionInicial(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  ubicacionId: string,
  cantidad: number
): Promise<void> {
  if (cantidad <= 0) return;
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "inventario_stock_ubicacion");
  await pool().query(
    `INSERT INTO ${t} (empresa_id, producto_id, ubicacion_id, stock_actual, es_principal)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, true)
     ON CONFLICT (empresa_id, producto_id, ubicacion_id)
     DO UPDATE SET stock_actual = ${t}.stock_actual + EXCLUDED.stock_actual, updated_at = now()`,
    [empresaId, productoId, ubicacionId, cantidad]
  );
}

export interface StockUbicacionRow {
  id: string;
  producto_id: string;
  ubicacion_id: string;
  ubicacion_nombre: string;
  ubicacion_tipo: string;
  stock_actual: string | number;
  es_principal: boolean;
}

export async function listStockPorUbicacion(
  schemaRaw: string,
  empresaId: string,
  productoId: string
): Promise<StockUbicacionRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tS = quoteSchemaTable(schema, "inventario_stock_ubicacion");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
  const { rows } = await pool().query<StockUbicacionRow>(
    `SELECT s.id, s.producto_id, s.ubicacion_id,
            u.nombre AS ubicacion_nombre, u.tipo AS ubicacion_tipo,
            s.stock_actual, s.es_principal
       FROM ${tS} s
       JOIN ${tU} u ON u.id = s.ubicacion_id
      WHERE s.empresa_id = $1::uuid AND s.producto_id = $2::uuid
      ORDER BY s.es_principal DESC, u.nombre`,
    [empresaId, productoId]
  );
  return rows;
}
