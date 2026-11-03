-- =============================================================================
-- 29. Las mesas del salón se cargan UNA vez
-- =============================================================================
--
-- POR QUE
-- Abrir una cuenta pedía escribir el nombre de la mesa cada vez. En un bar las
-- mesas son siempre las mismas: escribir "5" veinte veces por noche no es
-- cargar un dato, es una traba. Y peor, cada quien la escribe como quiere
-- ("5", "Mesa 5", "mesa 5"), así que el mismo lugar termina figurando como tres
-- mesas distintas y los totales por mesa no sirven.
--
-- Esta tabla es el salón: las mesas que existen de verdad. La pantalla las
-- muestra siempre —libre, ocupada o esperando cobro— y tocar una libre abre su
-- cuenta sin preguntar nada.
--
-- QUE NO HACE
-- No toca las cuentas. Una cuenta guarda el NOMBRE de la mesa, no un vínculo a
-- esta tabla: borrar una mesa del salón no borra ni cambia lo que ya se vendió
-- ahí. Por eso tampoco hay clave foránea contra los pedidos.
--
-- IMPORTA LO QUE YA SE USO: las mesas que aparecen en las cuentas de los
-- últimos 90 días entran solas al salón, así no hay que cargarlas a mano.
--
-- Idempotente. Sólo toca `cerveceriaerp`.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cerveceriaerp.mesas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  sucursal_id  uuid NOT NULL,
  nombre       text NOT NULL,
  -- Para agrupar el salón: "Terraza", "Barra", "Salón". Opcional.
  sector       text,
  -- En qué orden se muestran. Mismo número = alfabético.
  orden        integer NOT NULL DEFAULT 0,
  activa       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Dos mesas con el mismo nombre en la misma sucursal son la misma mesa: es
-- justamente lo que este script viene a evitar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mesas_empresa_sucursal_nombre
  ON cerveceriaerp.mesas (empresa_id, sucursal_id, upper(btrim(nombre)));

-- La pantalla siempre pide las mesas de una sucursal, ordenadas.
CREATE INDEX IF NOT EXISTS ix_mesas_sucursal_orden
  ON cerveceriaerp.mesas (empresa_id, sucursal_id, orden);

-- ---------------------------------------------------------------------------
-- Traer las mesas que ya se usaron (últimos 90 días)
-- ---------------------------------------------------------------------------
DO $importar$
DECLARE
  v_creadas bigint := 0;
BEGIN
  INSERT INTO cerveceriaerp.mesas (empresa_id, sucursal_id, nombre, orden)
  SELECT p.empresa_id,
         p.sucursal_id,
         btrim(p.brief_data ->> 'mesa')                    AS nombre,
         -- Las que son número se ordenan como número: la 10 va después de la 9.
         COALESCE(NULLIF(regexp_replace(p.brief_data ->> 'mesa', '\D', '', 'g'), '')::int, 500) AS orden
    FROM cerveceriaerp.proyectos p
   WHERE p.metadata ->> 'source' = 'mesa'
     AND COALESCE(p.brief_data ->> 'modalidad', 'local') = 'local'
     AND COALESCE(btrim(p.brief_data ->> 'mesa'), '') <> ''
     AND p.fecha_ingreso > now() - interval '90 days'
   GROUP BY p.empresa_id, p.sucursal_id, btrim(p.brief_data ->> 'mesa'),
            COALESCE(NULLIF(regexp_replace(p.brief_data ->> 'mesa', '\D', '', 'g'), '')::int, 500)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_creadas = ROW_COUNT;
  RAISE NOTICE 'Mesas importadas de las cuentas existentes: %', v_creadas;
END
$importar$;

-- PostgREST cachea el schema: sin esto la app no ve la tabla nueva.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Cómo quedó el salón
-- ---------------------------------------------------------------------------
SELECT s.nombre AS sucursal, m.nombre AS mesa, m.sector, m.orden, m.activa
  FROM cerveceriaerp.mesas m
  JOIN cerveceriaerp.sucursales s ON s.id = m.sucursal_id
 ORDER BY s.nombre, m.orden, m.nombre;

-- Si falta alguna, se agrega desde la pantalla: Caja → Mesas → "Editar salón"
-- → "Agregar mesa". Desde ahí también se renombran y se sacan.
