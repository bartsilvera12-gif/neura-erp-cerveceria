-- =============================================================================
-- 22. Un nombre, un proveedor
-- =============================================================================
--
-- POR QUE
-- El script 16 cerró el RUC duplicado, pero la mitad de los proveedores se
-- carga SIN RUC, y dos fichas con el mismo nombre parten las compras y las
-- cuentas por pagar en dos: cada una muestra la mitad de la deuda y nadie lo
-- nota hasta que falta plata en una.
--
-- La app ya lo rechaza al crear y al renombrar. Esto lo cierra también en la
-- base, por lo mismo que el RUC: dos altas simultáneas pasan las dos la
-- comprobación, y una carga masiva o un script no pasan por la pantalla.
--
-- COMPARA COMO UNA PERSONA
-- Sin mayúsculas, sin acentos y sin espacios de más: "Cerveshopp",
-- "CERVESHOPP" y "Cerveshopp  " son el mismo proveedor. No usa `unaccent`
-- porque esa extensión puede no estar instalada; `translate` con las vocales
-- acentuadas y la ñ alcanza para el castellano y no depende de nada.
--
-- SI YA HAY DUPLICADOS el índice no se puede crear. El script no falla con un
-- error críptico: los lista y te dice qué unificar.
--
-- Idempotente. Sólo toca el schema `cerveceriaerp`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Hay nombres repetidos hoy?
-- ---------------------------------------------------------------------------
SELECT btrim(regexp_replace(
         translate(upper(coalesce(nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
         '\s+', ' ', 'g')) AS nombre_normalizado,
       count(*) AS cuantos,
       string_agg(coalesce(ruc, 'sin RUC'), ' | ' ORDER BY created_at) AS rucs
  FROM cerveceriaerp.proveedores
 WHERE coalesce(btrim(nombre), '') <> ''
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY 2 DESC;
-- Si devuelve filas, hay que unificar esos proveedores ANTES de seguir:
-- apuntar las compras al que queda y borrar o desactivar el otro.

-- ---------------------------------------------------------------------------
-- 2. El índice
-- ---------------------------------------------------------------------------
DO $nom$
DECLARE
  v_dups int;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT 1 FROM cerveceriaerp.proveedores
     WHERE coalesce(btrim(nombre), '') <> ''
     GROUP BY empresa_id,
              btrim(regexp_replace(
                translate(upper(coalesce(nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
                '\s+', ' ', 'g'))
    HAVING count(*) > 1
  ) d;

  IF v_dups > 0 THEN
    RAISE EXCEPTION
      'Hay % nombres repetidos: el indice no se puede crear hasta unificarlos. La consulta de arriba los lista.',
      v_dups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'cerveceriaerp' AND c.relname = 'proveedores_nombre_uq'
  ) THEN
    CREATE UNIQUE INDEX proveedores_nombre_uq
      ON cerveceriaerp.proveedores
         (empresa_id,
          btrim(regexp_replace(
            translate(upper(coalesce(nombre, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
            '\s+', ' ', 'g')))
     WHERE coalesce(btrim(nombre), '') <> '';
    RAISE NOTICE 'Indice proveedores_nombre_uq creado.';
  ELSE
    RAISE NOTICE 'El indice proveedores_nombre_uq ya existia.';
  END IF;
END
$nom$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT count(*) AS indice_creado
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'cerveceriaerp' AND c.relname = 'proveedores_nombre_uq';
-- Esperado: 1

SELECT count(*) AS proveedores FROM cerveceriaerp.proveedores;
