-- =============================================================================
-- 10. Pago mixto en ventas
-- =============================================================================
--
-- POR QUÉ HACE FALTA ESTO
-- La venta guarda UN `metodo_pago`, y el arqueo de caja suma
-- `WHERE metodo_pago='efectivo'`. Si se agrega "mixto" sin guardar en qué se
-- repartió el cobro, la parte en efectivo desaparece del arqueo y la caja deja
-- de cerrar: el cajero ve menos efectivo esperado del que tiene en el cajón.
--
-- DÓNDE SE GUARDA EL REPARTO
-- En una columna `pagos_desglose jsonb` de `ventas`, escrita en el MISMO insert
-- que la venta. Ya existe `ventas_pagos_detalle`, que es donde va el detalle
-- para conciliación bancaria (entidad, referencia, titular), pero esa tabla se
-- escribe después de la venta y en modo best-effort: si falla, la venta igual
-- queda bien. Para la conciliación eso está bien; para el cierre de caja no,
-- porque un detalle que no se escribió haría cerrar la caja con menos plata de
-- la que hay. Por eso el reparto va en la venta, atómico, y el detalle sigue
-- yendo a `ventas_pagos_detalle` para la conciliación.
--
-- Forma del jsonb: {"efectivo": 50000, "transferencia": 30000, "tarjeta": 0}
-- Solo se escribe cuando `metodo_pago = 'mixto'`; en el resto queda NULL.
--
-- Idempotente: se puede correr más de una vez.
-- Solo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columna del reparto
-- ---------------------------------------------------------------------------
ALTER TABLE cerveceriaerp.ventas
  ADD COLUMN IF NOT EXISTS pagos_desglose jsonb;

COMMENT ON COLUMN cerveceriaerp.ventas.pagos_desglose IS
  'Reparto del cobro por método cuando metodo_pago = ''mixto''. '
  'Ej: {"efectivo": 50000, "transferencia": 30000}. NULL en los demás casos. '
  'Lo lee el arqueo de caja para saber cuánto efectivo entró.';

-- ---------------------------------------------------------------------------
-- 2. Permitir 'mixto' en el CHECK de metodo_pago, si hay uno
-- ---------------------------------------------------------------------------
-- El CHECK se reconstruye a partir del que exista en vez de asumir su nombre o
-- su lista: así el script sirve igual si la instalación tiene otra variante.
DO $mp$
DECLARE
  v_conname text;
  v_def     text;
BEGIN
  SELECT con.conname, pg_get_constraintdef(con.oid)
    INTO v_conname, v_def
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
  WHERE nsp.nspname = 'cerveceriaerp'
    AND cls.relname = 'ventas'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%metodo_pago%'
  LIMIT 1;

  IF v_conname IS NULL THEN
    RAISE NOTICE 'ventas.metodo_pago no tiene CHECK; no hay nada que ampliar.';
    RETURN;
  END IF;

  IF position('''mixto''' IN v_def) > 0 THEN
    RAISE NOTICE 'El metodo_pago "mixto" ya estaba permitido (%).', v_conname;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE cerveceriaerp.ventas DROP CONSTRAINT %I', v_conname);
  EXECUTE format(
    'ALTER TABLE cerveceriaerp.ventas ADD CONSTRAINT %I CHECK (
       metodo_pago IS NULL OR metodo_pago = ANY (ARRAY[
         ''efectivo'',''transferencia'',''tarjeta'',''mixto''
       ])
     )', v_conname);
  RAISE NOTICE 'metodo_pago "mixto" agregado a % (definición previa: %).', v_conname, v_def;
END
$mp$;

-- ---------------------------------------------------------------------------
-- 3. Una venta mixta SIEMPRE tiene que decir cómo se repartió
-- ---------------------------------------------------------------------------
-- Sin esta regla, un bug en la app podría grabar `metodo_pago='mixto'` sin
-- reparto, y la venta entraría al arqueo como si no hubiera entrado efectivo.
-- Mejor que la base lo rechace: un error al registrar la venta se ve y se
-- corrige; una caja que no cierra se descubre al final del turno.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'cerveceriaerp'
      AND cls.relname = 'ventas'
      AND con.conname = 'ventas_mixto_exige_desglose'
  ) THEN
    ALTER TABLE cerveceriaerp.ventas
      ADD CONSTRAINT ventas_mixto_exige_desglose CHECK (
        metodo_pago IS DISTINCT FROM 'mixto'
        OR (pagos_desglose IS NOT NULL AND jsonb_typeof(pagos_desglose) = 'object')
      );
    RAISE NOTICE 'CHECK ventas_mixto_exige_desglose creado.';
  ELSE
    RAISE NOTICE 'CHECK ventas_mixto_exige_desglose ya existía.';
  END IF;
END
$chk$;

-- ---------------------------------------------------------------------------
-- 4. `ventas_pagos_detalle` tiene que aceptar varias filas por venta
-- ---------------------------------------------------------------------------
-- Hasta ahora se insertaba una sola fila por venta. Con pago mixto son dos o
-- tres (una por método). Si quedó un UNIQUE sobre venta_id de cuando era una
-- sola, la segunda fila falla y el detalle de conciliación queda incompleto.
DO $uq$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'cerveceriaerp'
      AND cls.relname = 'ventas_pagos_detalle'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) ~ '^UNIQUE \(venta_id\)$'
  LOOP
    EXECUTE format(
      'ALTER TABLE cerveceriaerp.ventas_pagos_detalle DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'UNIQUE(venta_id) quitado de ventas_pagos_detalle (%).', r.conname;
  END LOOP;

  FOR r IN
    SELECT i.relname AS idxname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'cerveceriaerp'
      AND t.relname = 'ventas_pagos_detalle'
      AND x.indisunique
      AND NOT x.indisprimary
      AND pg_get_indexdef(x.indexrelid) ~ '\(venta_id\)$'
  LOOP
    EXECUTE format('DROP INDEX cerveceriaerp.%I', r.idxname);
    RAISE NOTICE 'Índice único sobre venta_id quitado (%).', r.idxname;
  END LOOP;
END
$uq$;

-- Buscar el detalle de una venta es la consulta de todos los días (ticket,
-- recibo, conciliación); sin índice es un seq scan sobre toda la tabla.
CREATE INDEX IF NOT EXISTS ventas_pagos_detalle_venta_idx
  ON cerveceriaerp.ventas_pagos_detalle (empresa_id, venta_id);

-- Las ventas mixtas del turno se buscan por sucursal y fecha en cada arqueo.
CREATE INDEX IF NOT EXISTS ventas_mixto_idx
  ON cerveceriaerp.ventas (empresa_id, sucursal_id, fecha)
  WHERE metodo_pago = 'mixto';

COMMIT;

-- PostgREST cachea el schema: sin esto la columna nueva no se ve desde la app.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='cerveceriaerp' AND table_name='ventas'
      AND column_name='pagos_desglose')                        AS columna_desglose,
  (SELECT count(*) FROM pg_constraint con
   JOIN pg_class cls ON cls.oid=con.conrelid
   JOIN pg_namespace nsp ON nsp.oid=cls.relnamespace
    WHERE nsp.nspname='cerveceriaerp' AND cls.relname='ventas'
      AND con.conname='ventas_mixto_exige_desglose')           AS check_mixto,
  (SELECT count(*) FROM pg_constraint con
   JOIN pg_class cls ON cls.oid=con.conrelid
   JOIN pg_namespace nsp ON nsp.oid=cls.relnamespace
    WHERE nsp.nspname='cerveceriaerp' AND cls.relname='ventas'
      AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%mixto%')       AS metodo_pago_acepta_mixto;
-- Esperado: 1 | 1 | 1
-- (la tercera puede dar 2 si el CHECK de metodo_pago y el de desglose
--  mencionan los dos la palabra "mixto", que es correcto.)
