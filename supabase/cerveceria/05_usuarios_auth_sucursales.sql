-- =============================================================================
-- 05 — Logins de los usuarios de Cervecería y Bar
-- =============================================================================
-- Corre DESPUÉS de `04_sucursales_cerveceria_bar.sql`.
--
-- El paso 04 crea la FICHA de cada usuario en `cerveceriaerp.usuarios` (nombre,
-- rol, empresa, sucursal), pero no el LOGIN: eso vive en `auth.users`, que es
-- el schema compartido de Supabase Auth. Sin este paso los dos usuarios existen
-- en el ERP pero no pueden entrar.
--
-- ⚠️  Igual que el 03, es el único paso que escribe fuera de `cerveceriaerp`.
--     No borra ni modifica usuarios ajenos: sólo agrega los dos de acá y, de
--     los tres de esta empresa, normaliza columnas que GoTrue necesita no-nulas.
--
-- ⚠️  AJUSTAR ANTES DE CORRER: las contraseñas de abajo. Son temporales y están
--     a la vista en el repositorio.
--
-- Si preferís no crear logins por SQL: creálos desde Studio (Authentication →
-- Users → Add user, con "Auto Confirm User" en sí) y corré sólo el PASO 3.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO 1 — Crear los logins en Supabase Auth
-- -----------------------------------------------------------------------------
DO $auth$
DECLARE
  -- ↓↓↓ AJUSTAR: emails (deben coincidir con los del paso 04) y contraseñas ↓↓↓
  v_usuarios CONSTANT jsonb := '[
    {"email": "cerveceria@cerveceria.com", "password": "CambiarCerveceria2026"},
    {"email": "bar@cerveceria.com",        "password": "CambiarBar2026"}
  ]'::jsonb;
  -- ↑↑↑ AJUSTAR ↑↑↑

  u       jsonb;
  v_email text;
  v_id    uuid;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(v_usuarios)
  LOOP
    v_email := lower(trim(u ->> 'email'));

    SELECT id INTO v_id FROM auth.users WHERE lower(email) = v_email;
    IF v_id IS NOT NULL THEN
      RAISE NOTICE '% ya existe en auth.users (%). No se toca su contraseña.', v_email, v_id;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.usuarios WHERE lower(email) = v_email) THEN
      RAISE EXCEPTION 'No existe % en cerveceriaerp.usuarios — corré antes el paso 04 (y revisá que los emails coincidan).', v_email;
    END IF;

    v_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(u ->> 'password', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(), now()
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );

    RAISE NOTICE 'Login creado para % (auth id %)', v_email, v_id;
  END LOOP;
END
$auth$;

-- -----------------------------------------------------------------------------
-- PASO 2 — Normalizar las columnas de token
-- -----------------------------------------------------------------------------
-- GoTrue lee varias columnas de `auth.users` como texto no-nulo. Un usuario
-- insertado a mano las deja en NULL, y el login falla con el poco claro
-- "Database error querying schema".
--
-- Sólo toca las columnas que existan en esta versión de GoTrue, y sólo las
-- filas de los usuarios de esta empresa.
-- -----------------------------------------------------------------------------
DO $fix$
DECLARE
  v_cols CONSTANT text[] := ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ];
  c     text;
  v_set text := '';
BEGIN
  FOREACH c IN ARRAY v_cols LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_attribute a
        JOIN pg_class t ON t.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'auth' AND t.relname = 'users'
         AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);
    v_set := v_set || CASE WHEN v_set = '' THEN '' ELSE ', ' END
             || format('%I = coalesce(%I, '''')', c, c);
  END LOOP;

  IF v_set = '' THEN
    RAISE NOTICE 'Esta versión de GoTrue no tiene columnas de token que normalizar.';
    RETURN;
  END IF;

  EXECUTE format($q$
    UPDATE auth.users a SET %s
     WHERE EXISTS (
       SELECT 1 FROM cerveceriaerp.usuarios u
        WHERE lower(u.email) = lower(a.email)
          AND u.empresa_id = %L::uuid)
  $q$, v_set, '0cbefe95-4007-402c-97de-70147f9d39bb');
END
$fix$;

-- -----------------------------------------------------------------------------
-- PASO 3 — Enlazar cada login con su ficha del ERP
-- -----------------------------------------------------------------------------
UPDATE cerveceriaerp.usuarios u
   SET auth_user_id = a.id
  FROM auth.users a
 WHERE lower(u.email) = lower(a.email)
   AND u.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND u.auth_user_id IS DISTINCT FROM a.id;

COMMIT;

-- =============================================================================
-- Verificación — los tres usuarios deben tener auth_user_id y confirmado
-- =============================================================================
SELECT u.email,
       u.rol,
       s.nombre                             AS arranca_en,
       (u.auth_user_id IS NOT NULL)         AS tiene_login,
       (a.email_confirmed_at IS NOT NULL)   AS confirmado
  FROM cerveceriaerp.usuarios u
  LEFT JOIN cerveceriaerp.sucursales s ON s.id = u.sucursal_predeterminada_id
  LEFT JOIN auth.users a ON a.id = u.auth_user_id
 WHERE u.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
 ORDER BY u.email;
