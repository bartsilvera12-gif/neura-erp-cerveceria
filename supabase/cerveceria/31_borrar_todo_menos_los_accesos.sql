-- =============================================================================
-- 31. Arranque en limpio TOTAL (se borra también el catálogo)
-- =============================================================================
--
-- DIFERENCIA CON EL 30
-- El 30 borra lo que se movió y deja el catálogo en pie, para seguir usando
-- los productos y los precios ya cargados. Este borra TAMBIEN el catálogo:
-- productos, categorías, ubicaciones, recetas, proveedores, clientes,
-- fermentadores y las mesas del salón. Es para cargar todo de nuevo desde
-- cero, no para limpiar una prueba.
--
-- QUE SOBREVIVE
-- Solamente con qué entrar y qué se ve: la empresa, las sucursales, los
-- usuarios con sus permisos y sucursales, los módulos, el plan, la
-- configuración de facturación y los catálogos fiscales de la DNIT (que no
-- son datos de la cervecería, son de Paraguay). Si esto también se borrara,
-- habría que rehacer los accesos antes de poder entrar a la pantalla.
--
-- COMO SE ORDENA
-- No hay lista de nombres a mano: arranca de las tablas de arriba y le
-- PREGUNTA A LA BASE quién las referencia, hasta abajo. Después borra
-- intentando: la tabla que todavía está referenciada espera la vuelta
-- siguiente. Una lista a mano envejece y el borrado se corta a mitad de
-- camino; esto no.
--
-- ESTO NO SE DESHACE, y acá se va el trabajo de carga, no solo las pruebas.
-- Antes de correrlo, backup en Supabase (Database → Backups).
--
-- Sólo toca `cerveceriaerp`.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PASO 1 — Qué se va a borrar, tabla por tabla (no borra nada)
-- ---------------------------------------------------------------------------
-- Imprime la lista completa, con cuántas filas tiene cada una. Mirala antes
-- de seguir: es exactamente lo que va a desaparecer.
DO $mirar$
DECLARE
  protegidas text[] := ARRAY[
    'empresas', 'sucursales', 'usuarios', 'usuario_sucursales',
    'modulos', 'empresa_modulos', 'usuario_modulos',
    'planes', 'suscripciones',
    'dashboard_views', 'empresa_dashboard_views', 'usuario_dashboard_views',
    'empresa_facturacion_modo', 'empresa_sifen_config',
    'obligaciones_tributarias_catalogo', 'cliente_tipos_servicio_catalogo',
    'proyecto_estados', 'proyecto_tipos', 'proyecto_prioridades_config',
    'tipificaciones', 'crm_etapas'
  ];
  r      record;
  n      bigint;
  total  bigint := 0;
BEGIN
  FOR r IN
    SELECT c.relname::text AS tabla
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'cerveceriaerp'
       AND c.relkind = 'r'
       AND NOT (c.relname::text = ANY (protegidas))
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM cerveceriaerp.%I', r.tabla) INTO n;
    total := total + n;
    IF n > 0 THEN
      RAISE NOTICE '% : % filas', r.tabla, n;
    END IF;
  END LOOP;
  RAISE NOTICE '---';
  RAISE NOTICE 'Total de filas que se van a borrar: %', total;
END
$mirar$;


-- ---------------------------------------------------------------------------
-- PASO 2 — Borrar (recién después de mirar el paso 1 y de hacer el backup)
-- ---------------------------------------------------------------------------
BEGIN;

DO $limpiar$
DECLARE
  -- Lo único que sobrevive: con qué entrar y qué se ve.
  protegidas text[] := ARRAY[
    'empresas', 'sucursales', 'usuarios', 'usuario_sucursales',
    'modulos', 'empresa_modulos', 'usuario_modulos',
    'planes', 'suscripciones',
    'dashboard_views', 'empresa_dashboard_views', 'usuario_dashboard_views',
    'empresa_facturacion_modo', 'empresa_sifen_config',
    'obligaciones_tributarias_catalogo', 'cliente_tipos_servicio_catalogo',
    'proyecto_estados', 'proyecto_tipos', 'proyecto_prioridades_config',
    'tipificaciones', 'crm_etapas'
  ];

  pendientes text[];
  t          text;
  resto      text[];
  borradas   bigint;
  total      bigint := 0;
  avanzo     boolean;
  vueltas    integer := 0;
BEGIN
  -- Todo lo que no está protegido.
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}')
    INTO pendientes
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'cerveceriaerp'
     AND c.relkind = 'r'
     AND NOT (c.relname::text = ANY (protegidas));

  -- Borrar intentando: la que todavía está referenciada espera la vuelta
  -- siguiente. Mientras una vuelta logre borrar algo, se sigue.
  LOOP
    vueltas := vueltas + 1;
    avanzo  := false;
    resto   := '{}';

    FOREACH t IN ARRAY pendientes LOOP
      BEGIN
        EXECUTE format('DELETE FROM cerveceriaerp.%I', t);
        GET DIAGNOSTICS borradas = ROW_COUNT;
        total  := total + borradas;
        avanzo := true;
        IF borradas > 0 THEN
          RAISE NOTICE '% : % filas borradas', t, borradas;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        resto := resto || t;
      END;
    END LOOP;

    pendientes := resto;
    EXIT WHEN cardinality(pendientes) = 0;

    IF NOT avanzo THEN
      -- Pasa si una tabla protegida referencia a una que se borra, o si hay
      -- un ciclo. Mejor cortar todo que dejar la mitad.
      RAISE EXCEPTION 'No se pudo terminar de borrar: % quedaron referenciadas. No se borró nada.',
        array_to_string(pendientes, ', ');
    END IF;
  END LOOP;

  RAISE NOTICE '---';
  RAISE NOTICE 'Filas borradas: % (en % vueltas)', total, vueltas;
END
$limpiar$;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ---------------------------------------------------------------------------
-- PASO 3 — Qué quedó con filas
-- ---------------------------------------------------------------------------
DO $ver$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT c.relname::text AS tabla
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'cerveceriaerp' AND c.relkind = 'r'
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM cerveceriaerp.%I', r.tabla) INTO n;
    IF n > 0 THEN RAISE NOTICE '% : % filas', r.tabla, n; END IF;
  END LOOP;
END
$ver$;

-- Lo que queda tiene que ser sólo empresa, sucursales, usuarios, módulos,
-- plan y los catálogos fiscales. Después se carga de nuevo desde la pantalla:
-- categorías, ubicaciones, productos con su precio, proveedores, clientes,
-- recetas, fermentadores y las mesas del salón. El stock arranca en cero y
-- entra con un movimiento de ENTRADA o con una compra.
