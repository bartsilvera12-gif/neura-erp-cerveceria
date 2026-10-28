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
