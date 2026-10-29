-- =============================================================================
-- 03 — Login de admin@cerveceria.com
-- =============================================================================
-- ⚠️  Este es el ÚNICO paso que toca algo fuera de `cerveceriaerp`: el login vive
--     en `auth.users`, que es compartido por toda la instancia de Supabase.
--     No hay forma de evitarlo salvo usando otro proyecto Supabase.
--     No borra ni modifica ningún usuario existente: sólo agrega uno nuevo.
--
-- OPCIÓN A (recomendada, sin SQL):
--   Supabase Studio → Authentication → Users → "Add user" → "Create new user"
--     Email: admin@cerveceria.com
--     Password: la que elijas
--     Auto Confirm User: SÍ
--   Después corré sólo el PASO 2 de abajo para enlazarlo.
--
-- OPCIÓN B: correr este archivo entero. Cambiá la contraseña en `v_password`.
--
-- Para los usuarios de Cervecería y Bar que crea el paso 04, usá el paso 05.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASO 1 — Crear el usuario en Supabase Auth (saltear si usaste la Opción A)
-- -----------------------------------------------------------------------------
DO $auth$
DECLARE
  v_email    CONSTANT text := 'admin@cerveceria.com';
  v_password CONSTANT text := 'Cerveceria2026';   -- ← CAMBIAR
  v_id       uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = v_email;

  IF v_id IS NOT NULL THEN
    RAISE NOTICE 'El usuario % ya existe en auth.users (%). No se modifica.', v_email, v_id;
    RETURN;
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
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now()
  );

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  RAISE NOTICE 'Usuario % creado en auth.users con id %', v_email, v_id;
END
$auth$;

-- -----------------------------------------------------------------------------
-- PASO 1b — Normalizar las columnas de token
-- -----------------------------------------------------------------------------
-- GoTrue lee varias columnas de `auth.users` como texto no-nulo. Un usuario
-- insertado a mano las deja en NULL y el login falla con el poco claro
-- "Database error querying schema".
--
-- Sólo toca las columnas que existan en esta versión de GoTrue, y sólo la fila
-- de este usuario.
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

  EXECUTE format('UPDATE auth.users SET %s WHERE lower(email) = %L',
                 v_set, 'admin@cerveceria.com');
END
$fix$;

-- PostgREST cachea el schema: sin esto la app no ve lo que acaba de cambiar.
NOTIFY pgrst, 'reload schema';


-- -----------------------------------------------------------------------------
-- PASO 2 — Enlazar el login con la fila de `cerveceriaerp.usuarios`
--          (correr siempre, hayas usado la Opción A o la B)
-- -----------------------------------------------------------------------------
UPDATE cerveceriaerp.usuarios u
   SET auth_user_id = a.id
  FROM auth.users a
 WHERE lower(u.email) = 'admin@cerveceria.com'
   AND lower(a.email) = 'admin@cerveceria.com'
   AND u.auth_user_id IS DISTINCT FROM a.id;

-- -----------------------------------------------------------------------------
-- Verificación
-- -----------------------------------------------------------------------------
SELECT u.id AS usuario_erp_id, u.email, u.rol, u.empresa_id,
       u.auth_user_id, a.email_confirmed_at
  FROM cerveceriaerp.usuarios u
  LEFT JOIN auth.users a ON a.id = u.auth_user_id
 WHERE lower(u.email) = 'admin@cerveceria.com';
