-- =============================================================================
-- 02 — Seed mínimo de `cerveceriaerp`
-- =============================================================================
-- Corre DESPUÉS de `01_crear_schema_cerveceriaerp.sql`.
--
-- Crea lo imprescindible para poder entrar al ERP, y nada más:
--   · 1 empresa propia           → id 0cbefe95-4007-402c-97de-70147f9d39bb
--   · 1 sucursal "Casa Central"  → id 37907a1a-5283-4b65-ae4e-4254924a1a82
--   · catálogo `modulos`         → todos los slugs que conoce la app
--   · `empresa_modulos`          → activos los módulos del ERP de origen
--   · 1 usuario admin            → admin@cerveceria.com (rol `admin`)
--
-- NO copia ninguna fila de `reservacaacupe`: las filas se construyen desde cero
-- leyendo sólo la DEFINICIÓN de las tablas de `cerveceriaerp`. Las columnas que
-- no se nombran acá quedan en su DEFAULT (o NULL), así que no hereda RUC,
-- timbrados, certificados SIFEN ni nada del otro cliente.
--
-- Sólo escribe en `cerveceriaerp`. Es re-ejecutable (no duplica filas).
--
-- El login de Supabase Auth se crea aparte, con `03_usuario_auth.sql`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

-- -----------------------------------------------------------------------------
-- Helper temporal: INSERT mínimo.
-- Inserta sólo las columnas de `p_over` más las NOT NULL sin default (a las que
-- les da un valor neutro según el tipo). Vive en pg_temp: desaparece al cerrar
-- la sesión y no deja rastro en el schema.
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.neura_insert_min(p_schema text, p_table text, p_over jsonb)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  r      record;
  v_cols text := '';
  v_vals text := '';
  v_val  text;
  v_unknown text;
BEGIN
  FOR r IN
    SELECT a.attname,
           a.attnotnull,
           a.atthasdef,
           a.attidentity,
           a.attgenerated,
           format_type(a.atttypid, a.atttypmod) AS typ,
           t.typtype,
           t.typname,
           a.atttypid
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE n.nspname = p_schema AND c.relname = p_table
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum
  LOOP
    CONTINUE WHEN r.attgenerated <> '';

    IF p_over ? r.attname THEN
      v_val := quote_nullable(p_over ->> r.attname) || '::' || r.typ;
    ELSIF r.atthasdef OR r.attidentity <> '' OR NOT r.attnotnull THEN
      CONTINUE;  -- default, identity o nullable: que lo resuelva Postgres
    ELSE
      -- NOT NULL sin default y sin valor explícito: valor neutro por tipo.
      v_val := CASE
        WHEN r.typtype = 'e' THEN
          quote_literal((SELECT e.enumlabel FROM pg_enum e
                          WHERE e.enumtypid = r.atttypid
                          ORDER BY e.enumsortorder LIMIT 1)) || '::' || r.typ
        WHEN r.typ LIKE '%[]'                                        THEN '''{}''::' || r.typ
        WHEN r.typname IN ('text','varchar','bpchar','name','citext') THEN '''''' 
        WHEN r.typname = 'bool'                                       THEN 'false'
        WHEN r.typname IN ('int2','int4','int8','numeric','float4','float8') THEN '0'
        WHEN r.typname = 'uuid'                                       THEN 'gen_random_uuid()'
        WHEN r.typname = 'date'                                       THEN 'CURRENT_DATE'
        WHEN r.typname IN ('timestamp','timestamptz')                 THEN 'now()'
        WHEN r.typname IN ('time','timetz')                           THEN '''00:00:00''::' || r.typ
        WHEN r.typname IN ('json','jsonb')                            THEN '''{}''::' || r.typ
        ELSE NULL
      END;
      IF v_val IS NULL THEN
        RAISE EXCEPTION 'Columna %.%.% es NOT NULL sin default y de tipo % — agregala a p_over',
          p_schema, p_table, r.attname, r.typ;
      END IF;
    END IF;

    v_cols := v_cols || CASE WHEN v_cols = '' THEN '' ELSE ', ' END || quote_ident(r.attname);
    v_vals := v_vals || CASE WHEN v_vals = '' THEN '' ELSE ', ' END || v_val;
  END LOOP;

  -- Una clave de `p_over` que no sea columna de la tabla sería un valor perdido
  -- en silencio (p. ej. 'nombre' donde la columna se llama 'nombre_empresa').
  SELECT string_agg(k, ', ') INTO v_unknown
    FROM jsonb_object_keys(p_over) AS k
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = p_schema AND c.relname = p_table
        AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION '%.% no tiene la(s) columna(s): %', p_schema, p_table, v_unknown;
  END IF;

  EXECUTE format('INSERT INTO %I.%I (%s) VALUES (%s)', p_schema, p_table, v_cols, v_vals);
END
$fn$;

DO $seed$
DECLARE
  tgt         CONSTANT text := 'cerveceriaerp';
  v_empresa   CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal  CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';
  v_email     CONSTANT text := 'admin@cerveceria.com';

  -- Catálogo completo de módulos que la app conoce (ver src/lib/modulos/route-slug-map.ts).
  -- `activo` = los que están habilitados en el ERP de origen.
  v_modulos CONSTANT jsonb := '[
    {"slug":"dashboard",                  "nombre":"Dashboard",                  "activo":true},
    {"slug":"clientes",                   "nombre":"Clientes",                   "activo":true},
    {"slug":"gestion-clientes",           "nombre":"Gestión Clientes",           "activo":true},
    {"slug":"ventas",                     "nombre":"Caja",                       "activo":true},
    {"slug":"presupuestos",               "nombre":"Presupuestos",               "activo":true},
    {"slug":"pagos",                      "nombre":"Pagos",                      "activo":true},
    {"slug":"gastos",                     "nombre":"Gastos",                     "activo":true},
    {"slug":"cuentas_por_pagar",          "nombre":"Cuentas por pagar",          "activo":true},
    {"slug":"notas_credito",              "nombre":"Notas de crédito",           "activo":true},
    {"slug":"reportes",                   "nombre":"Reportes",                   "activo":true},
    {"slug":"inventario",                 "nombre":"Inventario",                 "activo":true},
    {"slug":"reposicion",                 "nombre":"Reposición",                 "activo":true},
    {"slug":"compras",                    "nombre":"Compras",                    "activo":true},
    {"slug":"recetas",                    "nombre":"Recetas",                    "activo":true},
    {"slug":"produccion",                 "nombre":"Producción",                 "activo":true},
    {"slug":"proyectos",                  "nombre":"Pedidos",                    "activo":true},
    {"slug":"configuracion",              "nombre":"Configuración",              "activo":true},
    {"slug":"usuarios",                   "nombre":"Usuarios",                   "activo":true},
    {"slug":"caja",                       "nombre":"Caja (cierres)",             "activo":false},
    {"slug":"comisiones",                 "nombre":"Comisiones",                 "activo":false},
    {"slug":"planes",                     "nombre":"Planes",                     "activo":false},
    {"slug":"crm",                        "nombre":"CRM Funnel",                 "activo":false},
    {"slug":"marketing",                  "nombre":"Marketing Legacy",           "activo":false},
    {"slug":"marketing_ops",              "nombre":"Marketing Ops",              "activo":false},
    {"slug":"campanas",                   "nombre":"Campañas",                   "activo":false},
    {"slug":"sorteos",                    "nombre":"Sorteos",                    "activo":false},
    {"slug":"conversaciones",             "nombre":"Conversaciones",             "activo":false},
    {"slug":"historial-omnicanal",        "nombre":"Historial omnicanal",        "activo":false},
    {"slug":"conversaciones-finalizadas", "nombre":"Conversaciones finalizadas", "activo":false},
    {"slug":"monitoreo",                  "nombre":"Monitoreo",                  "activo":false},
    {"slug":"omnicanal",                  "nombre":"Omnicanal (paquete)",        "activo":false}
  ]'::jsonb;

  -- Pestañas del tablero principal (ver src/lib/dashboard/resolve-effective-dashboard-views.ts).
  v_dash_views CONSTANT jsonb := '[
    {"slug":"comercial",  "nombre":"Comercial",  "orden":10},
    {"slug":"financiero", "nombre":"Financiero", "orden":20},
    {"slug":"inventario", "nombre":"Inventario", "orden":30},
    {"slug":"ventas",     "nombre":"Ventas",     "orden":40}
  ]'::jsonb;

  m          jsonb;
  v_modulo   uuid;
  v_usuario  uuid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Empresa
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.empresas WHERE id = v_empresa) THEN
    PERFORM pg_temp.neura_insert_min(tgt, 'empresas',
      jsonb_build_object('id', v_empresa::text, 'nombre_empresa', 'Cervecería'));
  END IF;

  -- ---------------------------------------------------------------------------
  -- Sucursal principal
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.sucursales WHERE id = v_sucursal) THEN
    PERFORM pg_temp.neura_insert_min(tgt, 'sucursales',
      jsonb_build_object(
        'id',           v_sucursal::text,
        'empresa_id',   v_empresa::text,
        'nombre',       'Casa Central',
        'codigo',       'CC',
        'es_principal', 'true'));
  END IF;

  -- ---------------------------------------------------------------------------
  -- Catálogo de módulos + habilitación por empresa
  -- ---------------------------------------------------------------------------
  FOR m IN SELECT * FROM jsonb_array_elements(v_modulos)
  LOOP
    SELECT id INTO v_modulo FROM cerveceriaerp.modulos WHERE slug = (m ->> 'slug');

    IF v_modulo IS NULL THEN
      PERFORM pg_temp.neura_insert_min(tgt, 'modulos',
        jsonb_build_object('nombre', m ->> 'nombre', 'slug', m ->> 'slug'));
      SELECT id INTO v_modulo FROM cerveceriaerp.modulos WHERE slug = (m ->> 'slug');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.empresa_modulos
                    WHERE empresa_id = v_empresa AND modulo_id = v_modulo) THEN
      PERFORM pg_temp.neura_insert_min(tgt, 'empresa_modulos',
        jsonb_build_object(
          'empresa_id', v_empresa::text,
          'modulo_id',  v_modulo::text,
          'activo',     m ->> 'activo'));
    ELSE
      UPDATE cerveceriaerp.empresa_modulos
         SET activo = (m ->> 'activo')::boolean
       WHERE empresa_id = v_empresa AND modulo_id = v_modulo;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- Catálogo de vistas del tablero (las 4 pestañas del dashboard).
  -- Sin estas filas el home muestra "Sin vistas asignadas". No hace falta tocar
  -- `empresa_dashboard_views`: vacío equivale a "todas las del catálogo".
  -- ---------------------------------------------------------------------------
  FOR m IN SELECT * FROM jsonb_array_elements(v_dash_views)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM cerveceriaerp.dashboard_views WHERE slug = (m ->> 'slug')) THEN
      PERFORM pg_temp.neura_insert_min(tgt, 'dashboard_views',
        jsonb_build_object(
          'slug',   m ->> 'slug',
          'nombre', m ->> 'nombre',
          'orden',  m ->> 'orden',
          'activo', 'true'));
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- Usuario administrador del ERP
  -- `rol = 'admin'` → ve todos los módulos activos de la empresa sin necesitar
  -- filas en `usuario_modulos`.
  -- `auth_user_id` lo completa `03_usuario_auth.sql`.
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_usuario FROM cerveceriaerp.usuarios WHERE lower(email) = v_email;
  IF v_usuario IS NULL THEN
    PERFORM pg_temp.neura_insert_min(tgt, 'usuarios',
      jsonb_build_object(
        'email',                      v_email,
        'nombre',                     'Administrador',
        'rol',                        'admin',
        'empresa_id',                 v_empresa::text,
        'sucursal_predeterminada_id', v_sucursal::text));
  ELSE
    UPDATE cerveceriaerp.usuarios
       SET rol = 'admin',
           empresa_id = v_empresa,
           sucursal_predeterminada_id = coalesce(sucursal_predeterminada_id, v_sucursal)
     WHERE id = v_usuario;
  END IF;

  RAISE NOTICE 'Seed de % listo. empresa_id = %', tgt, v_empresa;
END
$seed$;

COMMIT;

-- =============================================================================
-- Verificación
-- =============================================================================
SELECT e.id AS empresa_id, e.nombre_empresa AS empresa,
       (SELECT count(*) FROM cerveceriaerp.sucursales s WHERE s.empresa_id = e.id) AS sucursales,
       (SELECT count(*) FROM cerveceriaerp.empresa_modulos em WHERE em.empresa_id = e.id AND em.activo) AS modulos_activos,
       (SELECT count(*) FROM cerveceriaerp.usuarios u WHERE u.empresa_id = e.id) AS usuarios
  FROM cerveceriaerp.empresas e;

SELECT slug, nombre, orden, activo FROM cerveceriaerp.dashboard_views ORDER BY orden;

SELECT m.slug, m.nombre, em.activo
  FROM cerveceriaerp.empresa_modulos em
  JOIN cerveceriaerp.modulos m ON m.id = em.modulo_id
 WHERE em.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
 ORDER BY em.activo DESC, m.slug;
