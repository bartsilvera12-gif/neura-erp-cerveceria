-- =============================================================================
-- 04 — Dos administraciones dentro del mismo negocio: Cervecería y Bar
-- =============================================================================
-- Corre DESPUÉS de `02_seed_cerveceriaerp.sql`.
--
-- El ERP ya separa por sucursal: productos, categorías, recetas, movimientos de
-- inventario, ventas, compras, órdenes de compra, gastos, presupuestos,
-- facturas, notas de crédito, pagos, cuentas por cobrar/pagar y caja llevan
-- `sucursal_id`. SKU y código de barras son únicos POR SUCURSAL, así que cada
-- administración arma su catálogo sin pisar al otro.
--
-- Quedan COMPARTIDOS (no llevan `sucursal_id`): clientes, proveedores y el
-- padrón de usuarios.
--
-- Este script:
--   · renombra la sucursal inicial a "Cervecería" y crea "Bar"
--   · da de alta un usuario por sucursal
--   · deja a admin@cerveceria.com con acceso a LAS DOS (cuenta del dueño)
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable.
--
-- ⚠️  AJUSTAR ANTES DE CORRER: los emails de los dos usuarios operativos.
--     Los logins de Supabase Auth se crean aparte (ver `03_usuario_auth.sql`).
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $suc$
DECLARE
  v_empresa    CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_cerveceria CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';  -- la sucursal del seed
  v_bar        CONSTANT uuid := 'b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31';

  -- ↓↓↓ AJUSTAR ↓↓↓
  v_mail_duenio     CONSTANT text := 'admin@cerveceria.com';
  v_mail_cerveceria CONSTANT text := 'cerveceria@cerveceria.com';
  v_mail_bar        CONSTANT text := 'bar@cerveceria.com';
  -- ↑↑↑ AJUSTAR ↑↑↑

  r record;
  v_usuario uuid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Sucursales
  -- ---------------------------------------------------------------------------
  -- `punto_expedicion` distinto por sucursal: es lo que permite que las dos
  -- numeren facturas con el mismo prefijo sin chocar (001-001 vs 001-002).
  UPDATE cerveceriaerp.sucursales
     SET codigo = 'CERVECERIA', nombre = 'Cervecería',
         es_principal = true, activa = true,
         establecimiento = coalesce(establecimiento, '001'),
         punto_expedicion = coalesce(punto_expedicion, '001')
   WHERE id = v_cerveceria;

  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.sucursales WHERE id = v_bar) THEN
    INSERT INTO cerveceriaerp.sucursales
      (id, empresa_id, codigo, nombre, es_principal, activa, establecimiento, punto_expedicion)
    VALUES
      (v_bar, v_empresa, 'BAR', 'Bar', false, true, '001', '002');
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Usuarios operativos, uno por sucursal
  --    `rol = 'admin'` → cada uno administra LO SUYO, no ve la otra sucursal.
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      (v_mail_cerveceria, 'Administración Cervecería', v_cerveceria),
      (v_mail_bar,        'Administración Bar',        v_bar)
    ) AS t(email, nombre, sucursal_id)
  LOOP
    SELECT id INTO v_usuario FROM cerveceriaerp.usuarios WHERE lower(email) = lower(r.email);

    IF v_usuario IS NULL THEN
      INSERT INTO cerveceriaerp.usuarios (email, nombre, rol, empresa_id, sucursal_predeterminada_id)
      VALUES (lower(r.email), r.nombre, 'admin', v_empresa, r.sucursal_id)
      RETURNING id INTO v_usuario;
    ELSE
      UPDATE cerveceriaerp.usuarios
         SET rol = 'admin', empresa_id = v_empresa, sucursal_predeterminada_id = r.sucursal_id
       WHERE id = v_usuario;
    END IF;

    INSERT INTO cerveceriaerp.usuario_sucursales (usuario_id, sucursal_id, empresa_id)
    VALUES (v_usuario, r.sucursal_id, v_empresa)
    ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. Cuenta del dueño: acceso a las DOS sucursales
  --    `usuario_sucursales` define a qué sucursales puede entrar;
  --    `sucursal_predeterminada_id` sólo dice con cuál arranca la sesión.
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_usuario FROM cerveceriaerp.usuarios WHERE lower(email) = lower(v_mail_duenio);
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'No existe el usuario % — corré antes 02_seed_cerveceriaerp.sql', v_mail_duenio;
  END IF;

  UPDATE cerveceriaerp.usuarios
     SET sucursal_predeterminada_id = coalesce(sucursal_predeterminada_id, v_cerveceria)
   WHERE id = v_usuario;

  INSERT INTO cerveceriaerp.usuario_sucursales (usuario_id, sucursal_id, empresa_id)
  VALUES (v_usuario, v_cerveceria, v_empresa), (v_usuario, v_bar, v_empresa)
  ON CONFLICT (usuario_id, sucursal_id) DO NOTHING;

  RAISE NOTICE 'Sucursales listas. Cervecería=% Bar=%', v_cerveceria, v_bar;
END
$suc$;

COMMIT;

-- =============================================================================
-- Verificación
-- =============================================================================
SELECT s.codigo, s.nombre, s.es_principal, s.activa, s.establecimiento, s.punto_expedicion
  FROM cerveceriaerp.sucursales s
 WHERE s.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
 ORDER BY s.es_principal DESC, s.nombre;

SELECT u.email, u.rol,
       sd.nombre AS arranca_en,
       (SELECT string_agg(s2.nombre, ', ' ORDER BY s2.nombre)
          FROM cerveceriaerp.usuario_sucursales us
          JOIN cerveceriaerp.sucursales s2 ON s2.id = us.sucursal_id
         WHERE us.usuario_id = u.id) AS puede_entrar_a
  FROM cerveceriaerp.usuarios u
  LEFT JOIN cerveceriaerp.sucursales sd ON sd.id = u.sucursal_predeterminada_id
 WHERE u.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
 ORDER BY u.email;
