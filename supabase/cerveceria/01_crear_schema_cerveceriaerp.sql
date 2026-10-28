-- =============================================================================
-- 01 — Clon ESTRUCTURAL de `reservacaacupe` → `cerveceriaerp` (SIN DATOS)
-- =============================================================================
-- Qué hace: lee el catálogo de Postgres del schema `reservacaacupe` y reproduce
-- en `cerveceriaerp` tipos, secuencias, tablas, defaults, constraints, índices,
-- vistas, vistas materializadas, FKs, triggers, RLS + policies, privilegios y
-- privilegios por defecto. No copia NI UNA FILA.
--
-- Aislamiento: el script SÓLO escribe dentro de `cerveceriaerp`. `reservacaacupe`,
-- `public`, `auth`, `storage` y cualquier otro schema se leen pero NUNCA se modifican.
--
-- Las FKs que en el origen apuntan fuera de `reservacaacupe` (p. ej. `auth.users`)
-- se mantienen apuntando al mismo destino; las internas se reapuntan a `cerveceriaerp`.
--
-- Es re-ejecutable: lo que ya existe se saltea con un NOTICE.
-- Ejecutar como `postgres` / `supabase_admin`. Después correr `02_seed_cerveceriaerp.sql`.
-- =============================================================================

BEGIN;

SET LOCAL check_function_bodies = off;
-- search_path reducido a propósito: fuerza a que pg_get_*def() devuelva TODO
-- schema-calificado, que es lo que permite reescribir `reservacaacupe.` de forma segura.
SET LOCAL search_path = pg_catalog, pg_temp;

DO $clone$
DECLARE
  src   CONSTANT text := 'reservacaacupe';
  tgt   CONSTANT text := 'cerveceriaerp';
  r         record;
  v_sql     text;
  v_def     text;
  v_pend    text[];
  v_next    text[];
  v_name    text;
  v_progress boolean;
  v_owner   text;
  v_tmin    bigint;
  v_tmax    bigint;
  v_dmin    bigint;
  v_dmax    bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = src) THEN
    RAISE EXCEPTION 'No existe el schema origen %', src;
  END IF;

  SELECT pg_get_userbyid(nspowner) INTO v_owner FROM pg_namespace WHERE nspname = src;

  -- ---------------------------------------------------------------------------
  -- 0. Schema
  -- ---------------------------------------------------------------------------
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', tgt);
  BEGIN
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', tgt, v_owner);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'owner del schema sin cambiar (%): %', v_owner, SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- 1. Tipos ENUM
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT t.typname,
           (SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
              FROM pg_enum e WHERE e.enumtypid = t.oid) AS labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = src AND t.typtype = 'e'
     ORDER BY t.typname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_type t2 JOIN pg_namespace n2 ON n2.oid = t2.typnamespace
       WHERE n2.nspname = tgt AND t2.typname = r.typname);
    EXECUTE format('CREATE TYPE %I.%I AS ENUM (%s)', tgt, r.typname, r.labels);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. Dominios (tipo base, NOT NULL, default y CHECKs)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT t.oid,
           t.typname,
           format_type(t.typbasetype, t.typtypmod) AS basetype,
           t.typnotnull,
           pg_get_expr(t.typdefaultbin, 0) AS defexpr
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = src AND t.typtype = 'd'
     ORDER BY t.typname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_type t2 JOIN pg_namespace n2 ON n2.oid = t2.typnamespace
       WHERE n2.nspname = tgt AND t2.typname = r.typname);
    v_sql := format('CREATE DOMAIN %I.%I AS %s', tgt, r.typname,
                    regexp_replace(r.basetype, '\m' || src || '\M', tgt, 'g'));
    IF r.defexpr IS NOT NULL THEN
      v_sql := v_sql || ' DEFAULT ' || regexp_replace(r.defexpr, '\m' || src || '\M', tgt, 'g');
    END IF;
    IF r.typnotnull THEN
      v_sql := v_sql || ' NOT NULL';
    END IF;
    EXECUTE v_sql;

    FOR v_def, v_name IN
      SELECT pg_get_constraintdef(c.oid), c.conname FROM pg_constraint c WHERE c.contypid = r.oid
    LOOP
      EXECUTE format('ALTER DOMAIN %I.%I ADD CONSTRAINT %I %s', tgt, r.typname, v_name,
                     regexp_replace(v_def, '\m' || src || '\M', tgt, 'g'));
    END LOOP;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. Tipos compuestos
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT t.typname,
           (SELECT string_agg(format('%I %s', a.attname,
                     regexp_replace(format_type(a.atttypid, a.atttypmod), '\m' || src || '\M', tgt, 'g')),
                     ', ' ORDER BY a.attnum)
              FROM pg_attribute a
             WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS cols
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid
     WHERE n.nspname = src AND t.typtype = 'c' AND c.relkind = 'c'
     ORDER BY t.typname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_type t2 JOIN pg_namespace n2 ON n2.oid = t2.typnamespace
       WHERE n2.nspname = tgt AND t2.typname = r.typname);
    EXECUTE format('CREATE TYPE %I.%I AS (%s)', tgt, r.typname, r.cols);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 4. Funciones y procedimientos
  --    (check_function_bodies=off: los cuerpos pueden referenciar tablas que
  --     todavía no existen en este punto)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = src
       AND p.prokind IN ('f', 'p', 'w')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE regexp_replace(r.def, '\m' || src || '\M', tgt, 'g');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'función %.% no clonada: %', src, r.proname, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = src AND p.prokind = 'a'
  LOOP
    RAISE NOTICE 'AGREGADO % no clonado automáticamente — revisar a mano', r.proname;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 5. Tablas (estructura de columnas; sin constraints ni índices todavía)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname);
    EXECUTE format(
      'CREATE TABLE %I.%I (LIKE %I.%I INCLUDING DEFAULTS INCLUDING GENERATED '
      'INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS INCLUDING COMPRESSION '
      'INCLUDING STATISTICS)', tgt, r.relname, src, r.relname);
  END LOOP;

  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND c.relkind = 'p'
  LOOP
    RAISE NOTICE 'tabla PARTICIONADA % no clonada automáticamente — revisar a mano', r.relname;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 5b. Reapuntar los tipos de columna al schema destino.
  --     `LIKE` copia la columna con SU tipo, así que un `estado_venta` seguiría
  --     siendo `reservacaacupe.estado_venta`. Las tablas están vacías, así que
  --     el cambio de tipo no toca datos.
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, a.attname, a.attgenerated,
           format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_type et ON et.oid = t.typelem
      JOIN pg_namespace tn ON tn.oid = coalesce(nullif(et.typnamespace, 0), t.typnamespace)
     WHERE n.nspname = tgt AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND tn.nspname = src
     ORDER BY c.relname, a.attnum
  LOOP
    IF r.attgenerated <> '' THEN
      RAISE NOTICE 'columna generada %.%.% conserva el tipo del schema origen — revisar a mano',
        tgt, r.relname, r.attname;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)', tgt, r.relname) INTO v_progress;
    IF v_progress THEN
      RAISE NOTICE 'tabla %.% no está vacía: el tipo de % no se reapunta', tgt, r.relname, r.attname;
      CONTINUE;
    END IF;

    v_def := regexp_replace(r.typ, '\m' || src || '\M', tgt, 'g');
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT', tgt, r.relname, r.attname);
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE %s USING NULL::%s',
                   tgt, r.relname, r.attname, v_def, v_def);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 6. Secuencias que no quedaron creadas por IDENTITY (p. ej. columnas serial)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, s.seqtypid::regtype::text AS seqtype, s.seqstart, s.seqincrement,
           s.seqmax, s.seqmin, s.seqcache, s.seqcycle
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src
     ORDER BY c.relname
  LOOP
    -- MINVALUE/MAXVALUE sólo si difieren del default del tipo, para que el
    -- clon quede idéntico a un `serial` del origen y no con límites explícitos.
    v_tmin := CASE r.seqtype WHEN 'smallint' THEN -32768 WHEN 'integer' THEN -2147483648
                             ELSE (-9223372036854775807)::bigint - 1 END;
    v_tmax := CASE r.seqtype WHEN 'smallint' THEN 32767 WHEN 'integer' THEN 2147483647
                             ELSE 9223372036854775807 END;
    IF r.seqincrement > 0 THEN
      v_dmin := 1;          v_dmax := v_tmax;
    ELSE
      v_dmin := v_tmin;     v_dmax := -1;
    END IF;

    EXECUTE format(
      CASE WHEN EXISTS (SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
                         WHERE n2.nspname = tgt AND c2.relname = r.relname AND c2.relkind = 'S')
           THEN 'ALTER SEQUENCE %I.%I AS %s INCREMENT BY %s %s %s START WITH %s CACHE %s %s'
           ELSE 'CREATE SEQUENCE %I.%I AS %s INCREMENT BY %s %s %s START WITH %s CACHE %s %s' END,
      tgt, r.relname, r.seqtype, r.seqincrement,
      CASE WHEN r.seqmin = v_dmin THEN 'NO MINVALUE' ELSE 'MINVALUE ' || r.seqmin END,
      CASE WHEN r.seqmax = v_dmax THEN 'NO MAXVALUE' ELSE 'MAXVALUE ' || r.seqmax END,
      r.seqstart, r.seqcache,
      CASE WHEN r.seqcycle THEN 'CYCLE' ELSE 'NO CYCLE' END);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 7. Defaults, tomados del ORIGEN y reescritos al schema destino.
  --    Se reaplican todos (no sólo los que mencionan el schema) porque el paso
  --    5b descarta el default de las columnas cuyo tipo se reapuntó.
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid) AS def
      FROM pg_attrdef ad
      JOIN pg_class c ON c.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ad.adnum
     WHERE n.nspname = src
       AND c.relkind = 'r'
       AND a.attidentity = ''
       AND a.attgenerated = ''
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_attribute a2
        JOIN pg_class c2 ON c2.oid = a2.attrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname
         AND a2.attname = r.attname AND a2.attnum > 0 AND NOT a2.attisdropped);
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s', tgt, r.relname, r.attname,
                     regexp_replace(r.def, '\m' || src || '\M', tgt, 'g'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'default de %.%.% no aplicado: %', tgt, r.relname, r.attname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 8. Propiedad de secuencias (OWNED BY) replicada dentro del schema destino
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT sc.relname AS seqname, tc.relname AS tabname, a.attname
      FROM pg_depend d
      JOIN pg_class sc ON sc.oid = d.objid AND sc.relkind = 'S'
      JOIN pg_namespace sn ON sn.oid = sc.relnamespace
      JOIN pg_class tc ON tc.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = d.refobjsubid
     WHERE d.classid = 'pg_class'::regclass
       AND d.refclassid = 'pg_class'::regclass
       AND d.deptype = 'a'
       AND sn.nspname = src
       AND d.refobjsubid > 0
  LOOP
    BEGIN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNED BY %I.%I.%I', tgt, r.seqname, tgt, r.tabname, r.attname);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'OWNED BY de la secuencia % sin aplicar: %', r.seqname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 9. Constraints PK / UNIQUE / EXCLUDE / CHECK (conservando los nombres originales)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS def, con.contype
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src
       AND con.contype IN ('p', 'u', 'x', 'c')
     ORDER BY CASE con.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'x' THEN 3 ELSE 4 END,
              c.relname, con.conname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_constraint con2
        JOIN pg_class c2 ON c2.oid = con2.conrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname AND con2.conname = r.conname);
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', tgt, r.relname, r.conname,
                     regexp_replace(r.def, '\m' || src || '\M', tgt, 'g'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'constraint %.% no aplicada: %', r.relname, r.conname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 10. Vistas (varias pasadas: resuelve dependencias entre vistas)
  -- ---------------------------------------------------------------------------
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), '{}')
    INTO v_pend
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = src AND c.relkind = 'v';

  LOOP
    EXIT WHEN cardinality(v_pend) = 0;
    v_progress := false;
    v_next := '{}';
    FOREACH v_name IN ARRAY v_pend LOOP
      SELECT regexp_replace(regexp_replace(pg_get_viewdef(c.oid, true), '\m' || src || '\M', tgt, 'g'), ';\s*$', ''),
             CASE WHEN c.reloptions IS NULL THEN ''
                  ELSE ' WITH (' || array_to_string(c.reloptions, ', ') || ')' END
        INTO v_def, v_sql
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = src AND c.relname = v_name AND c.relkind = 'v';
      BEGIN
        EXECUTE format('CREATE OR REPLACE VIEW %I.%I%s AS %s', tgt, v_name, v_sql, v_def);
        v_progress := true;
      EXCEPTION WHEN OTHERS THEN
        v_next := v_next || v_name;
      END;
    END LOOP;
    IF NOT v_progress THEN
      FOREACH v_name IN ARRAY v_next LOOP
        RAISE NOTICE 'vista % no clonada (dependencia sin resolver) — revisar a mano', v_name;
      END LOOP;
      EXIT;
    END IF;
    v_pend := v_next;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 11. Vistas materializadas (vacías: WITH NO DATA)
  -- ---------------------------------------------------------------------------
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), '{}')
    INTO v_pend
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = src AND c.relkind = 'm';

  LOOP
    EXIT WHEN cardinality(v_pend) = 0;
    v_progress := false;
    v_next := '{}';
    FOREACH v_name IN ARRAY v_pend LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
         WHERE n2.nspname = tgt AND c2.relname = v_name);
      SELECT regexp_replace(regexp_replace(pg_get_viewdef(c.oid, true), '\m' || src || '\M', tgt, 'g'), ';\s*$', '')
        INTO v_def
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = src AND c.relname = v_name AND c.relkind = 'm';
      BEGIN
        EXECUTE format('CREATE MATERIALIZED VIEW %I.%I AS %s WITH NO DATA', tgt, v_name, v_def);
        v_progress := true;
      EXCEPTION WHEN OTHERS THEN
        v_next := v_next || v_name;
      END;
    END LOOP;
    IF NOT v_progress THEN
      FOREACH v_name IN ARRAY v_next LOOP
        RAISE NOTICE 'vista materializada % no clonada — revisar a mano', v_name;
      END LOOP;
      EXIT;
    END IF;
    v_pend := v_next;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 12. Índices que NO respaldan una constraint (los de PK/UNIQUE ya se crearon)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT ic.relname AS idxname, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src
       AND c.relkind IN ('r', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
     ORDER BY ic.relname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.idxname);
    BEGIN
      EXECUTE regexp_replace(r.def, '\m' || src || '\M', tgt, 'g');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'índice % no creado: %', r.idxname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 13. Foreign keys
  --     Las internas se reapuntan a `cerveceriaerp`; las que salen del schema
  --     (auth.users, public.*, …) conservan su destino original.
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND con.contype = 'f'
     ORDER BY c.relname, con.conname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_constraint con2
        JOIN pg_class c2 ON c2.oid = con2.conrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname AND con2.conname = r.conname);
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', tgt, r.relname, r.conname,
                     regexp_replace(r.def, '\m' || src || '\M', tgt, 'g'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'FK %.% no aplicada: %', r.relname, r.conname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 14. Triggers
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND NOT t.tgisinternal
     ORDER BY c.relname, t.tgname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_trigger t2
        JOIN pg_class c2 ON c2.oid = t2.tgrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname AND t2.tgname = r.tgname);
    BEGIN
      EXECUTE regexp_replace(r.def, '\m' || src || '\M', tgt, 'g');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'trigger %.% no creado: %', r.relname, r.tgname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 15. Row Level Security + policies
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND c.relkind = 'r' AND (c.relrowsecurity OR c.relforcerowsecurity)
  LOOP
    IF r.relrowsecurity THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tgt, r.relname);
    END IF;
    IF r.relforcerowsecurity THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', tgt, r.relname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname, pol.polname, pol.polpermissive, pol.polcmd,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           CASE WHEN pol.polroles = '{0}'::oid[] THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(ro.rolname), ', ' ORDER BY ro.rolname)
                        FROM pg_roles ro WHERE ro.oid = ANY (pol.polroles)) END AS roles
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src
     ORDER BY c.relname, pol.polname
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_policy p2
        JOIN pg_class c2 ON c2.oid = p2.polrelid
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname AND p2.polname = r.polname);

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    r.polname, tgt, r.relname,
                    CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                    CASE r.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                                  WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
                    coalesce(r.roles, 'PUBLIC'));
    IF r.using_expr IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)',
        regexp_replace(r.using_expr, '\m' || src || '\M', tgt, 'g'));
    END IF;
    IF r.check_expr IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)',
        regexp_replace(r.check_expr, '\m' || src || '\M', tgt, 'g'));
    END IF;
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'policy %.% no creada: %', r.relname, r.polname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 16. Privilegios sobre el schema (USAGE/CREATE para anon, authenticated, …)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
           a.privilege_type
      FROM pg_namespace n, aclexplode(n.nspacl) a
     WHERE n.nspname = src
  LOOP
    BEGIN
      EXECUTE format('GRANT %s ON SCHEMA %I TO %s', r.privilege_type, tgt, r.grantee);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'GRANT % ON SCHEMA sin aplicar para %: %', r.privilege_type, r.grantee, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 17. Privilegios sobre tablas, vistas y secuencias
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
           a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace,
           aclexplode(c.relacl) a
     WHERE n.nspname = src AND c.relkind IN ('r', 'v', 'm', 'S', 'p')
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
       WHERE n2.nspname = tgt AND c2.relname = r.relname);
    BEGIN
      EXECUTE format('GRANT %s ON %I.%I TO %s', r.privilege_type, tgt, r.relname, r.grantee);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'GRANT % ON %.% sin aplicar: %', r.privilege_type, tgt, r.relname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 18. Privilegios sobre funciones
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
           a.privilege_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace,
           aclexplode(p.proacl) a
     WHERE n.nspname = src AND p.prokind IN ('f', 'p', 'w')
  LOOP
    BEGIN
      -- ROUTINE cubre funciones y procedimientos por igual.
      EXECUTE format('GRANT %s ON ROUTINE %I.%I(%s) TO %s', r.privilege_type,
                     tgt, r.proname,
                     regexp_replace(r.args, '\m' || src || '\M', tgt, 'g'),
                     r.grantee);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'GRANT % ON ROUTINE %.% sin aplicar: %', r.privilege_type, tgt, r.proname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 19. Privilegios por defecto del schema (para objetos futuros)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT pg_get_userbyid(d.defaclrole) AS forrole,
           d.defaclobjtype,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
           a.privilege_type
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace,
           aclexplode(d.defaclacl) a
     WHERE n.nspname = src
  LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %s',
                     r.forrole, tgt, r.privilege_type,
                     CASE r.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                                          WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                                          ELSE 'SCHEMAS' END,
                     r.grantee);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'default privilege sin aplicar (% / %): %', r.forrole, r.privilege_type, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 19b. Comentarios de tablas, vistas, secuencias, funciones y tipos.
  --      (`LIKE INCLUDING COMMENTS` sólo trae los de columna.)
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, c.relkind, obj_description(c.oid, 'pg_class') AS cmt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = src AND c.relkind IN ('r', 'v', 'm', 'S')
       AND obj_description(c.oid, 'pg_class') IS NOT NULL
  LOOP
    BEGIN
      EXECUTE format('COMMENT ON %s %I.%I IS %L',
                     CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                    WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
                     tgt, r.relname, r.cmt);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'comentario de %.% sin copiar: %', tgt, r.relname, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           obj_description(p.oid, 'pg_proc') AS cmt
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = src AND p.prokind IN ('f', 'p', 'w')
       AND obj_description(p.oid, 'pg_proc') IS NOT NULL
  LOOP
    BEGIN
      EXECUTE format('COMMENT ON ROUTINE %I.%I(%s) IS %L', tgt, r.proname,
                     regexp_replace(r.args, '\m' || src || '\M', tgt, 'g'), r.cmt);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'comentario de la rutina %.% sin copiar: %', tgt, r.proname, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT t.typname, obj_description(t.oid, 'pg_type') AS cmt
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = src AND t.typtype IN ('e', 'd', 'c')
       AND obj_description(t.oid, 'pg_type') IS NOT NULL
  LOOP
    BEGIN
      EXECUTE format('COMMENT ON TYPE %I.%I IS %L', tgt, r.typname, r.cmt);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'comentario del tipo %.% sin copiar: %', tgt, r.typname, SQLERRM;
    END;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 20. Owner de los objetos clonados
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = tgt AND c.relkind IN ('r', 'v', 'm', 'S')
  LOOP
    BEGIN
      EXECUTE format('ALTER %s %I.%I OWNER TO %I',
                     CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                                    WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
                     tgt, r.relname, v_owner);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'owner de %.% sin cambiar: %', tgt, r.relname, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Clon estructural % → % terminado.', src, tgt;
END
$clone$;

COMMIT;

-- =============================================================================
-- Verificación: los conteos de ambos schemas deberían coincidir,
-- y `cerveceriaerp` debe tener 0 filas en todas sus tablas.
-- =============================================================================
SELECT 'tablas'      AS objeto,
       count(*) FILTER (WHERE n.nspname = 'reservacaacupe') AS reservacaacupe,
       count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')  AS cerveceriaerp
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp') AND c.relkind = 'r'
UNION ALL
SELECT 'vistas', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                 count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp') AND c.relkind IN ('v', 'm')
UNION ALL
SELECT 'indices', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                  count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp') AND c.relkind = 'i'
UNION ALL
SELECT 'constraints', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                      count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp')
UNION ALL
SELECT 'funciones', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                    count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp')
UNION ALL
SELECT 'triggers', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                   count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp') AND NOT t.tgisinternal
UNION ALL
SELECT 'policies', count(*) FILTER (WHERE n.nspname = 'reservacaacupe'),
                   count(*) FILTER (WHERE n.nspname = 'cerveceriaerp')
  FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('reservacaacupe', 'cerveceriaerp');
