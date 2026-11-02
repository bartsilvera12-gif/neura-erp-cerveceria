-- =============================================================================
-- 28. Habilitar "Caja (cierres)", que es a donde lleva Reportes → Caja
-- =============================================================================
--
-- POR QUE
-- Reportes tiene un acceso a Caja (la apertura, los movimientos del turno y el
-- arqueo de cierre), pero al entrar decía "módulo no habilitado". La pantalla
-- existe y funciona; lo que faltaba era el permiso: el módulo `caja` quedó
-- marcado como inactivo cuando se armó esta instancia, copiando la
-- configuración del ERP de origen.
--
-- Mientras siga inactivo no entra nadie, ni siquiera el administrador: una
-- desactivación explícita gana sobre cualquier otro permiso, y está bien que
-- sea así — si no, desactivar un módulo no significaría nada.
--
-- QUE HACE
--   1. Activa el módulo `caja` para la empresa.
--   2. Se lo da a los usuarios que ya tienen la Caja de ventas (`ventas`):
--      quien cobra es quien abre y cierra el turno.
--
-- El usuario admin no necesita el paso 2: ve todos los módulos activos.
--
-- Idempotente. Sólo toca `cerveceriaerp`.
-- =============================================================================

BEGIN;

DO $caja$
DECLARE
  v_modulo_caja   uuid;
  v_modulo_ventas uuid;
  v_empresa       uuid;
  v_dados         bigint := 0;
BEGIN
  SELECT id INTO v_modulo_caja FROM cerveceriaerp.modulos WHERE slug = 'caja';
  IF v_modulo_caja IS NULL THEN
    INSERT INTO cerveceriaerp.modulos (nombre, slug)
    VALUES ('Caja (cierres)', 'caja')
    RETURNING id INTO v_modulo_caja;
    RAISE NOTICE 'Módulo "Caja (cierres)" creado.';
  END IF;

  SELECT id INTO v_modulo_ventas FROM cerveceriaerp.modulos WHERE slug = 'ventas';
  IF v_modulo_ventas IS NULL THEN
    RAISE EXCEPTION 'No existe el módulo "ventas": corré antes el 02_seed_cerveceriaerp.sql.';
  END IF;

  -- 1. Activo para cada empresa que ya tiene la Caja de ventas
  FOR v_empresa IN
    SELECT DISTINCT empresa_id
      FROM cerveceriaerp.empresa_modulos
     WHERE modulo_id = v_modulo_ventas
  LOOP
    IF EXISTS (SELECT 1 FROM cerveceriaerp.empresa_modulos
                WHERE empresa_id = v_empresa AND modulo_id = v_modulo_caja) THEN
      UPDATE cerveceriaerp.empresa_modulos
         SET activo = true
       WHERE empresa_id = v_empresa AND modulo_id = v_modulo_caja AND activo IS DISTINCT FROM true;
    ELSE
      INSERT INTO cerveceriaerp.empresa_modulos (empresa_id, modulo_id, activo)
      VALUES (v_empresa, v_modulo_caja, true);
    END IF;
  END LOOP;

  -- 2. A quien cobra, el turno de caja también
  INSERT INTO cerveceriaerp.usuario_modulos (usuario_id, modulo_id)
  SELECT um.usuario_id, v_modulo_caja
    FROM cerveceriaerp.usuario_modulos um
   WHERE um.modulo_id = v_modulo_ventas
     AND NOT EXISTS (
       SELECT 1 FROM cerveceriaerp.usuario_modulos x
        WHERE x.usuario_id = um.usuario_id AND x.modulo_id = v_modulo_caja);
  GET DIAGNOSTICS v_dados = ROW_COUNT;
  RAISE NOTICE 'Caja (cierres) habilitada para % usuario(s) que ya cobran.', v_dados;
END
$caja$;

-- PostgREST cachea el schema: sin esto la app no ve lo que acaba de cambiar.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Cómo quedó
-- ---------------------------------------------------------------------------
SELECT m.slug, m.nombre, em.activo
  FROM cerveceriaerp.empresa_modulos em
  JOIN cerveceriaerp.modulos m ON m.id = em.modulo_id
 WHERE m.slug IN ('ventas', 'caja', 'mesas', 'reportes')
 ORDER BY m.slug;
-- `caja` tiene que decir activo = true. Después de correr esto, cerrá sesión y
-- volvé a entrar: el permiso se guarda en el navegador por diez minutos.
