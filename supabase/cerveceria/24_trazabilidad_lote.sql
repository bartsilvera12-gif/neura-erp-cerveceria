-- =============================================================================
-- 24. De qué lote salió lo que se vendió
-- =============================================================================
--
-- POR QUE
-- El envasado sabe que el lote coven-002 produjo 16 barriles. La venta sabe que
-- se vendieron 2. Nadie sabía CUALES: si un cliente devuelve un barril con
-- olor a cartón, no había forma de decir de qué cocción salió ni a quién más se
-- le vendió de la misma.
--
-- DOS COLUMNAS
--   · `produccion_lote_envasado.cantidad_vendida`: cuántas unidades de ese
--     envasado ya salieron. Es lo que permite repartir por orden de envasado
--     (lo primero que se envasó es lo primero que sale).
--   · `ventas_items.lote_codigo`: el CODIGO del lote, no su id. Si alguna vez
--     se borra un lote, la venta tiene que seguir diciendo de dónde salió.
--
-- La app las llena sola al registrar la venta: el cajero no elige nada.
--
-- LO VIEJO QUEDA EN BLANCO. Las ventas anteriores a este script no tienen de
-- dónde sacar el lote: inventarlo seria peor que dejarlo vacío.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

ALTER TABLE cerveceriaerp.produccion_lote_envasado
  ADD COLUMN IF NOT EXISTS cantidad_vendida numeric NOT NULL DEFAULT 0
    CHECK (cantidad_vendida >= 0);

ALTER TABLE cerveceriaerp.ventas_items
  ADD COLUMN IF NOT EXISTS lote_codigo text;

COMMENT ON COLUMN cerveceriaerp.produccion_lote_envasado.cantidad_vendida IS
  'Unidades de este envasado ya vendidas. La venta las asigna por orden de '
  'envasado (FIFO) y la anulacion las devuelve.';

COMMENT ON COLUMN cerveceriaerp.ventas_items.lote_codigo IS
  'Lote de produccion del que salio lo vendido. Es el codigo y no el id: la '
  'venta tiene que seguir respondiendo aunque el lote se borre. Puede llevar '
  'mas de uno ("coven-002 + coven-003") si una venta se llevo de dos.';

-- Buscar "qué ventas salieron del lote X" es la consulta que justifica todo
-- esto; sin índice es un scan de toda la tabla de ítems.
CREATE INDEX IF NOT EXISTS ventas_items_lote_idx
  ON cerveceriaerp.ventas_items (empresa_id, lote_codigo)
  WHERE lote_codigo IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT count(*) AS columnas_nuevas
  FROM information_schema.columns
 WHERE (table_schema, table_name, column_name) IN (
         ('cerveceriaerp', 'produccion_lote_envasado', 'cantidad_vendida'),
         ('cerveceriaerp', 'ventas_items', 'lote_codigo')
       );
-- Esperado: 2

-- ---------------------------------------------------------------------------
-- La consulta que ahora se puede responder
-- ---------------------------------------------------------------------------
-- A quién se le vendió cerveza del lote coven-002:
--
-- SELECT v.numero_control, v.fecha, c.nombre AS cliente,
--        vi.producto_nombre, vi.cantidad, vi.lote_codigo
--   FROM cerveceriaerp.ventas_items vi
--   JOIN cerveceriaerp.ventas v ON v.id = vi.venta_id
--   LEFT JOIN cerveceriaerp.clientes c ON c.id = v.cliente_id
--  WHERE vi.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
--    AND vi.lote_codigo LIKE '%coven-002%'
--  ORDER BY v.fecha;
