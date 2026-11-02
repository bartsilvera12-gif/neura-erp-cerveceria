-- =============================================================================
-- 26. El salón es un módulo aparte: el mozo no es el cajero
-- =============================================================================
--
-- POR QUE
-- Mesas y Comandas vivían dentro del módulo "Caja". Eso obligaba a darle Caja
-- al mozo para que pudiera abrir una mesa, y con Caja podía cobrar, anular una
-- venta y ver el arqueo del día. En un bar con tres personas en el turno, eso
-- no es un detalle de permisos: es quién puede tocar la plata.
--
-- Ahora son dos módulos:
--   · `mesas`  → Salón: abrir mesas, cargar rondas, mandar comandas y CERRAR la
--                mesa. Cerrar no cobra: la manda a la Caja.
--   · `ventas` → Caja: cobrar, incluida la pantalla "Por cobrar", donde el
--                cajero ve las mesas que el mozo cerró.
--
-- Quien tiene Caja también entra al salón (un cajero puede abrir una mesa). Al
-- revés no: tener el salón no abre la Caja.
--
-- QUE HACE
--   1. Crea el módulo `mesas` en el catálogo, si no está.
--   2. Lo activa para la empresa.
--   3. Se lo da a los usuarios que hoy tienen Caja, para que nadie pierda una
--      pantalla que ya usaba.
--
-- El usuario admin no necesita nada de esto: ve todos los módulos activos.
--
-- Idempotente. Sólo toca `cerveceriaerp`.
-- =============================================================================

BEGIN;

DO $salon$
DECLARE
  v_modulo_mesas  uuid;
  v_modulo_ventas uuid;
  v_empresa       uuid;
  v_dados         bigint := 0;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. El módulo en el catálogo
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_modulo_mesas FROM cerveceriaerp.modulos WHERE slug = 'mesas';
  IF v_modulo_mesas IS NULL THEN
    INSERT INTO cerveceriaerp.modulos (nombre, slug)
    VALUES ('Salón', 'mesas')
    RETURNING id INTO v_modulo_mesas;
    RAISE NOTICE 'Módulo "Salón" creado.';
  ELSE
    RAISE NOTICE 'El módulo "Salón" ya existía.';
  END IF;

  SELECT id INTO v_modulo_ventas FROM cerveceriaerp.modulos WHERE slug = 'ventas';
  IF v_modulo_ventas IS NULL THEN
    RAISE EXCEPTION 'No existe el módulo "ventas": corré antes el 02_seed_cerveceriaerp.sql.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Activado para cada empresa que ya tiene Caja
  -- ---------------------------------------------------------------------------
  FOR v_empresa IN
    SELECT DISTINCT empresa_id
      FROM cerveceriaerp.empresa_modulos
     WHERE modulo_id = v_modulo_ventas
  LOOP
    IF EXISTS (SELECT 1 FROM cerveceriaerp.empresa_modulos
                WHERE empresa_id = v_empresa AND modulo_id = v_modulo_mesas) THEN
      UPDATE cerveceriaerp.empresa_modulos
         SET activo = true
       WHERE empresa_id = v_empresa AND modulo_id = v_modulo_mesas AND activo IS DISTINCT FROM true;
    ELSE
      INSERT INTO cerveceriaerp.empresa_modulos (empresa_id, modulo_id, activo)
      VALUES (v_empresa, v_modulo_mesas, true);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. A quien ya tenía Caja, el salón también
  -- ---------------------------------------------------------------------------
  INSERT INTO cerveceriaerp.usuario_modulos (usuario_id, modulo_id)
  SELECT um.usuario_id, v_modulo_mesas
    FROM cerveceriaerp.usuario_modulos um
   WHERE um.modulo_id = v_modulo_ventas
     AND NOT EXISTS (
       SELECT 1 FROM cerveceriaerp.usuario_modulos x
        WHERE x.usuario_id = um.usuario_id AND x.modulo_id = v_modulo_mesas);
  GET DIAGNOSTICS v_dados = ROW_COUNT;
  RAISE NOTICE 'Salón habilitado para % usuario(s) que ya tenían Caja.', v_dados;
END
$salon$;

-- PostgREST cachea el schema: sin esto la app no ve lo que acaba de cambiar.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Cómo quedó: quién entra al salón y quién a la caja
-- ---------------------------------------------------------------------------
SELECT u.nombre,
       u.email,
       u.rol,
       CASE WHEN u.rol IN ('admin', 'administrador', 'super_admin') THEN 'todo (es admin)'
            ELSE coalesce(string_agg(m.slug, ', ' ORDER BY m.slug)
                   FILTER (WHERE m.slug IN ('mesas', 'ventas')), '— ninguno —')
       END AS acceso_bar
  FROM cerveceriaerp.usuarios u
  LEFT JOIN cerveceriaerp.usuario_modulos um ON um.usuario_id = u.id
  LEFT JOIN cerveceriaerp.modulos m ON m.id = um.modulo_id
 GROUP BY u.id, u.nombre, u.email, u.rol
 ORDER BY u.nombre;

-- PARA CREAR UN MOZO: en Usuarios, dale el módulo "Salón" y NO le des "Caja".
-- Va a poder abrir mesas, cargar rondas y cerrarlas; la mesa cerrada le aparece
-- al cajero en su pantalla de Caja, con el aviso de cuántas esperan y por
-- cuánta plata.
