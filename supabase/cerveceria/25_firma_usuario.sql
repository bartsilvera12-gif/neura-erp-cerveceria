-- =============================================================================
-- 25. Una sola forma de firmar: el nombre del usuario
-- =============================================================================
--
-- POR QUE
-- La columna "Usuario" de Movimientos de inventario mostraba tres cosas
-- distintas en la misma pantalla: "Administrador" en las compras, el correo
-- crudo "admin@cerveceria.com" en las ventas, y un guión en producción. No es
-- cuestión de prolijidad: así no se puede ni agrupar por persona ni responder
-- "¿quién tocó este stock?", que es para lo que existe la columna.
--
-- La app ya quedó arreglada: de ahora en más todo registro se firma con el
-- NOMBRE del usuario, y recién si no tiene nombre con el correo. Esto arregla
-- lo que YA está cargado, que la app no va a volver a escribir.
--
-- QUE HACE
--   1. Donde quedó guardado un correo, lo reemplaza por el nombre de ese
--      usuario.
--   2. Donde no quedó nada, lo completa a partir de quién creó la fila.
--
-- Recorre solo las tablas de `cerveceriaerp` que tienen la columna, así vale
-- también para compras, cobros, recibos y lo que venga después. NO toca otros
-- schemas.
--
-- Idempotente: correrlo dos veces no cambia nada la segunda vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cómo está hoy (antes de tocar nada)
-- ---------------------------------------------------------------------------
SELECT coalesce(usuario_nombre, '— sin registro —') AS firma,
       count(*) AS movimientos
  FROM cerveceriaerp.movimientos_inventario
 GROUP BY 1
 ORDER BY 2 DESC;

-- ---------------------------------------------------------------------------
-- 2. El reemplazo, tabla por tabla
-- ---------------------------------------------------------------------------
DO $firma$
DECLARE
  t           record;
  col_usuario text;
  cambiadas   bigint;
  total_mail  bigint := 0;
  total_vacio bigint := 0;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables ta
        ON ta.table_schema = c.table_schema
       AND ta.table_name = c.table_name
       AND ta.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'cerveceriaerp'
       AND c.column_name = 'usuario_nombre'
     ORDER BY c.table_name
  LOOP
    -- 2.a El correo guardado pasa a ser el nombre de esa persona.
    EXECUTE format(
      'UPDATE cerveceriaerp.%I r
          SET usuario_nombre = btrim(u.nombre)
         FROM cerveceriaerp.usuarios u
        WHERE lower(btrim(r.usuario_nombre)) = lower(btrim(u.email))
          AND coalesce(btrim(u.nombre), '''') <> ''''
          AND r.usuario_nombre IS DISTINCT FROM btrim(u.nombre)', t.table_name);
    GET DIAGNOSTICS cambiadas = ROW_COUNT;
    total_mail := total_mail + cambiadas;
    IF cambiadas > 0 THEN
      RAISE NOTICE '% : % firmas que eran un correo ahora dicen el nombre', t.table_name, cambiadas;
    END IF;

    -- 2.b Lo que quedó sin firmar se completa con quien creó la fila.
    --     `created_by` en casi todas; `usuario_id` en recibos y cobros.
    SELECT c.column_name INTO col_usuario
      FROM information_schema.columns c
     WHERE c.table_schema = 'cerveceriaerp'
       AND c.table_name = t.table_name
       AND c.column_name IN ('created_by', 'usuario_id')
     ORDER BY CASE c.column_name WHEN 'created_by' THEN 0 ELSE 1 END
     LIMIT 1;

    IF col_usuario IS NOT NULL THEN
      EXECUTE format(
        'UPDATE cerveceriaerp.%I r
            SET usuario_nombre = coalesce(nullif(btrim(u.nombre), ''''), btrim(u.email))
           FROM cerveceriaerp.usuarios u
          WHERE r.%I = u.id
            AND coalesce(btrim(r.usuario_nombre), '''') = ''''
            AND coalesce(nullif(btrim(u.nombre), ''''), btrim(u.email)) IS NOT NULL',
        t.table_name, col_usuario);
      GET DIAGNOSTICS cambiadas = ROW_COUNT;
      total_vacio := total_vacio + cambiadas;
      IF cambiadas > 0 THEN
        RAISE NOTICE '% : % filas sin firma ahora dicen quién fue', t.table_name, cambiadas;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Listo: % correos reemplazados por el nombre, % filas completadas.',
               total_mail, total_vacio;
  -- Las que siguen en blanco son de antes de que se guardara el usuario, o las
  -- hizo un proceso automático. No se inventa un nombre para ellas.
END
$firma$;

-- ---------------------------------------------------------------------------
-- 3. Cómo quedó
-- ---------------------------------------------------------------------------
SELECT coalesce(usuario_nombre, '— sin registro —') AS firma,
       count(*) AS movimientos
  FROM cerveceriaerp.movimientos_inventario
 GROUP BY 1
 ORDER BY 2 DESC;

-- Si acá todavía aparece algún correo, es de un usuario que no tiene nombre
-- cargado en Usuarios: ponele el nombre ahí y volvé a correr este script.
SELECT DISTINCT usuario_nombre
  FROM cerveceriaerp.movimientos_inventario
 WHERE usuario_nombre LIKE '%@%'
 ORDER BY 1;
