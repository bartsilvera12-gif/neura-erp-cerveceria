-- =============================================================================
-- 16. Un RUC, un proveedor
-- =============================================================================
--
-- POR QUE
-- El ERP ya chequeaba el RUC duplicado antes de crear un proveedor, pero ese
-- chequeo tiene dos límites que sólo la base puede cerrar:
--
--   · Dos pedidos simultáneos pasan los dos la comprobación y los dos insertan.
--   · El chequeo vive en un solo endpoint; una carga masiva o un script que
--     escriba directo no pasa por ahí.
--
-- Dos proveedores con el mismo RUC rompen la conciliación de compras y el
-- libro de IVA, y separarlos después obliga a tocar las compras ya cargadas.
--
-- COMPARA SIN GUIONES NI ESPACIOS
-- "80012345-7", "800123457" y "80012345 - 7" son el mismo RUC. El índice se
-- arma sobre la forma normalizada (sólo letras y números, en mayúscula), que
-- es la misma que usa la app.
--
-- Los proveedores SIN RUC no entran al índice: todavía hay varios cargados así
-- (las planillas no traían el RUC) y no son duplicados entre sí.
--
-- SI YA HAY DUPLICADOS el índice no se puede crear. En ese caso el script NO
-- falla con un error críptico: los lista y te dice qué unificar.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Hay duplicados hoy?
-- ---------------------------------------------------------------------------
SELECT regexp_replace(upper(ruc), '[^A-Z0-9]', '', 'g') AS ruc_normalizado,
       count(*) AS cuantos,
       string_agg(nombre, ' | ' ORDER BY created_at) AS proveedores
  FROM cerveceriaerp.proveedores
 WHERE ruc IS NOT NULL AND btrim(ruc) <> ''
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY 2 DESC;
-- Si esta consulta devuelve filas, hay que unificar esos proveedores ANTES de
-- seguir: apuntar las compras al que queda y desactivar el otro.

-- ---------------------------------------------------------------------------
-- 2. El índice
-- ---------------------------------------------------------------------------
DO $ruc$
DECLARE
  v_dups int;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT 1 FROM cerveceriaerp.proveedores
     WHERE ruc IS NOT NULL AND btrim(ruc) <> ''
     GROUP BY empresa_id, regexp_replace(upper(ruc), '[^A-Z0-9]', '', 'g')
    HAVING count(*) > 1
  ) d;

  IF v_dups > 0 THEN
    RAISE EXCEPTION
      'Hay % RUC repetidos: el indice no se puede crear hasta unificarlos. La consulta de arriba los lista.',
      v_dups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'cerveceriaerp' AND c.relname = 'proveedores_ruc_uq'
  ) THEN
    CREATE UNIQUE INDEX proveedores_ruc_uq
      ON cerveceriaerp.proveedores
         (empresa_id, regexp_replace(upper(ruc), '[^A-Z0-9]', '', 'g'))
     WHERE ruc IS NOT NULL AND btrim(ruc) <> '';
    RAISE NOTICE 'Indice proveedores_ruc_uq creado.';
  ELSE
    RAISE NOTICE 'El indice proveedores_ruc_uq ya existia.';
  END IF;
END
$ruc$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT count(*) AS indice_creado
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'cerveceriaerp' AND c.relname = 'proveedores_ruc_uq';
-- Esperado: 1

SELECT count(*) AS proveedores_sin_ruc
  FROM cerveceriaerp.proveedores
 WHERE ruc IS NULL OR btrim(ruc) = '';
-- Estos quedan fuera del indice. Conviene completarles el RUC: sin el no se
-- les puede cargar una compra ni una factura.
