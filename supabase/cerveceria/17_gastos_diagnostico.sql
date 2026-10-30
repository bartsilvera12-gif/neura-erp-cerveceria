-- =============================================================================
-- 17. Gastos: por qué no se crean (diagnóstico + arreglo)
-- =============================================================================
--
-- SINTOMA
-- "Creé un gasto y no se creó": el formulario no muestra nada y el gasto no
-- aparece en la lista.
--
-- QUE MIRA ESTE SCRIPT
-- Tres causas posibles, en orden de probabilidad, y las dos que se arreglan
-- desde la base las arregla:
--
--   1. La tabla `cerveceriaerp.gastos` no tiene las columnas que manda la app
--      (`beneficiario`, `metodo_pago`, `sucursal_id`). La migración que las
--      agregó está escrita sólo para el schema `reservacaacupe`, así que si el
--      clon se hizo antes, acá faltan. PostgREST rechaza el insert entero con
--      "Could not find the 'beneficiario' column of 'gastos'".  → LO ARREGLA.
--
--   2. La tabla tiene alguna columna NOT NULL sin default que la app no manda.
--      El insert falla con 23502.  → LAS LISTA (el paso 1 las muestra).
--
--   3. El gasto SE GUARDA, pero en otra sucursal que la que muestra la
--      pantalla. Eso era un bug de la app (la escritura usaba la sucursal
--      predeterminada y la lista la sucursal activa) y ya está corregido en el
--      código. El paso 4 muestra si hay gastos guardados y en qué sucursal, que
--      es la forma de confirmar que era esto.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cómo está la tabla hoy
-- ---------------------------------------------------------------------------
SELECT column_name,
       data_type,
       is_nullable,
       column_default
  FROM information_schema.columns
 WHERE table_schema = 'cerveceriaerp' AND table_name = 'gastos'
 ORDER BY ordinal_position;
-- Tienen que estar: id, empresa_id, sucursal_id, categoria, descripcion, monto,
-- tipo, recurrente, frecuencia, fecha, created_at, beneficiario, metodo_pago.
-- Si alguna dice is_nullable = NO y column_default = NULL, y no es `monto`,
-- `fecha`, `empresa_id` ni `id`, ahí está el 23502.

-- ---------------------------------------------------------------------------
-- 2. Las columnas que faltan, si faltan
-- ---------------------------------------------------------------------------
DO $gastos$
DECLARE
  v_sch CONSTANT text := 'cerveceriaerp';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = v_sch AND c.relname = 'gastos' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'No existe la tabla %.gastos: correr antes 01_crear_schema_cerveceriaerp.sql', v_sch;
  END IF;

  EXECUTE format('ALTER TABLE %I.gastos ADD COLUMN IF NOT EXISTS beneficiario text', v_sch);
  EXECUTE format('ALTER TABLE %I.gastos ADD COLUMN IF NOT EXISTS metodo_pago text', v_sch);

  -- `metodo_pago`: los mismos tres valores que usa ventas. NULL sigue valiendo
  -- para los gastos históricos que se cargaron sin el dato.
  BEGIN
    EXECUTE format(
      'ALTER TABLE %I.gastos ADD CONSTRAINT gastos_metodo_pago_check '
      'CHECK (metodo_pago IS NULL OR metodo_pago IN (''efectivo'', ''transferencia'', ''tarjeta''))',
      v_sch
    );
    RAISE NOTICE 'CHECK de metodo_pago creado.';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN check_violation THEN
      RAISE NOTICE 'Hay gastos con un metodo_pago fuera de la lista: el CHECK no se creo. Revisalos con la consulta 3.';
  END;

  -- `sucursal_id` va NULLABLE a propósito: los gastos cargados antes de
  -- multi-sucursal quedaron sin sucursal y ponerla NOT NULL ahora rompería la
  -- tabla. La app siempre la manda.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = v_sch AND table_name = 'gastos' AND column_name = 'sucursal_id'
  ) THEN
    EXECUTE format('ALTER TABLE %I.gastos ADD COLUMN sucursal_id uuid', v_sch);
    EXECUTE format(
      'ALTER TABLE %I.gastos ADD CONSTRAINT gastos_sucursal_fk '
      'FOREIGN KEY (sucursal_id) REFERENCES %I.sucursales(id)',
      v_sch, v_sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS gastos_sucursal_fecha_idx ON %I.gastos (sucursal_id, fecha)',
      v_sch
    );
    RAISE NOTICE 'Columna sucursal_id agregada.';
  END IF;

  EXECUTE format(
    'COMMENT ON COLUMN %I.gastos.beneficiario IS ''Nombre del comercio o empresa al que se hizo el pago (texto libre).''',
    v_sch
  );
  EXECUTE format(
    'COMMENT ON COLUMN %I.gastos.metodo_pago IS ''efectivo | transferencia | tarjeta. NULL en los gastos historicos.''',
    v_sch
  );
END
$gastos$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. Verificación: las tres columnas tienen que dar 3
-- ---------------------------------------------------------------------------
SELECT count(*) AS columnas_que_manda_la_app
  FROM information_schema.columns
 WHERE table_schema = 'cerveceriaerp'
   AND table_name = 'gastos'
   AND column_name IN ('beneficiario', 'metodo_pago', 'sucursal_id');
-- Esperado: 3

-- ---------------------------------------------------------------------------
-- 4. ¿Se guardaron gastos, y en qué sucursal?
-- ---------------------------------------------------------------------------
-- Si acá aparecen los gastos que cargaste, el alta funcionaba y el problema era
-- de qué sucursal los lista la pantalla.
SELECT g.created_at,
       g.fecha,
       g.categoria,
       g.descripcion,
       g.monto,
       g.metodo_pago,
       coalesce(s.nombre, '(sin sucursal)') AS sucursal
  FROM cerveceriaerp.gastos g
  LEFT JOIN cerveceriaerp.sucursales s ON s.id = g.sucursal_id
 ORDER BY g.created_at DESC
 LIMIT 20;

-- Cuántos hay por sucursal, para ver de un saque si están todos del otro lado.
SELECT coalesce(s.nombre, '(sin sucursal)') AS sucursal,
       count(*) AS gastos,
       sum(g.monto) AS total
  FROM cerveceriaerp.gastos g
  LEFT JOIN cerveceriaerp.sucursales s ON s.id = g.sucursal_id
 GROUP BY 1
 ORDER BY 2 DESC;

-- Y en qué sucursal está parado tu usuario vs. cuál tiene de predeterminada.
-- Si son distintas, el bug 3 te afectaba.
SELECT u.email,
       u.sucursal_predeterminada_id,
       sp.nombre AS predeterminada,
       string_agg(sx.nombre, ' | ' ORDER BY sx.nombre) AS puede_entrar_a
  FROM cerveceriaerp.usuarios u
  LEFT JOIN cerveceriaerp.sucursales sp ON sp.id = u.sucursal_predeterminada_id
  LEFT JOIN cerveceriaerp.usuario_sucursales us ON us.usuario_id = u.id
  LEFT JOIN cerveceriaerp.sucursales sx ON sx.id = us.sucursal_id
 GROUP BY u.email, u.sucursal_predeterminada_id, sp.nombre
 ORDER BY u.email;
