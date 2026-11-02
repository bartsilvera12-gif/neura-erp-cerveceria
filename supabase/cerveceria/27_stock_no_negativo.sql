-- =============================================================================
-- 27. El stock no se va a negativo
-- =============================================================================
--
-- POR QUE
-- En la prueba, una salida de 100 sobre un producto sin stock se guardó igual y
-- la Levadura quedó en -100. Un stock negativo no es un número feo: es una
-- cantidad que el sistema dice tener y que no existe, y a partir de ahí todo lo
-- que se calcula con eso (lo que falta comprar, el costo, el valor del
-- inventario) está mal.
--
-- La app ya lo valida, pero la validación vive en la pantalla y en el código:
-- una importación, un script o una pantalla con datos viejos se la saltean. La
-- base es el único lugar donde la regla no se puede esquivar.
--
-- QUE HACE
-- Rechaza cualquier escritura que deje `productos.stock_actual` por debajo de
-- cero, salvo:
--   · productos con `controla_stock = false` (un servicio, algo que se prepara
--     al momento: no tienen stock que controlar);
--   · una corrección que SUBE un stock que ya estaba negativo (hay que poder
--     arreglar lo que quedó mal antes de esto).
--
-- Idempotente. Sólo toca `cerveceriaerp`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Qué quedó en negativo hoy?
-- ---------------------------------------------------------------------------
SELECT p.sku,
       p.nombre,
       p.stock_actual,
       s.nombre AS sucursal
  FROM cerveceriaerp.productos p
  LEFT JOIN cerveceriaerp.sucursales s ON s.id = p.sucursal_id
 WHERE p.stock_actual < 0
 ORDER BY p.stock_actual;
-- Esos hay que corregirlos a mano, con un ajuste desde Inventario, para que
-- quede el movimiento que explica la corrección. El trigger de abajo deja
-- subirlos; lo que no deja es volver a bajarlos de cero.

-- ---------------------------------------------------------------------------
-- 2. La regla
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cerveceriaerp.stock_no_negativo()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.stock_actual IS NULL OR NEW.stock_actual >= 0 THEN
    RETURN NEW;
  END IF;

  -- Lo que no lleva stock puede quedar en cualquier número sin significar nada.
  IF coalesce(NEW.controla_stock, true) = false THEN
    RETURN NEW;
  END IF;

  -- Corregir hacia arriba un negativo viejo tiene que ser posible.
  IF TG_OP = 'UPDATE' AND OLD.stock_actual < 0 AND NEW.stock_actual > OLD.stock_actual THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'stock_negativo: % (%) quedaría en %, y hay %',
    NEW.nombre, NEW.sku, NEW.stock_actual,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stock_actual ELSE 0 END
    USING ERRCODE = '23514';
END
$fn$;

DROP TRIGGER IF EXISTS trg_stock_no_negativo ON cerveceriaerp.productos;
CREATE TRIGGER trg_stock_no_negativo
  BEFORE INSERT OR UPDATE OF stock_actual ON cerveceriaerp.productos
  FOR EACH ROW
  EXECUTE FUNCTION cerveceriaerp.stock_no_negativo();

-- PostgREST cachea el schema: sin esto la app no ve lo que acaba de cambiar.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. Comprobación
-- ---------------------------------------------------------------------------
DO $prueba$
DECLARE
  v_id uuid;
  v_ok boolean := false;
BEGIN
  SELECT id INTO v_id
    FROM cerveceriaerp.productos
   WHERE coalesce(controla_stock, true) AND stock_actual >= 0
   ORDER BY stock_actual
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'No hay ningún producto con stock para probar. El trigger quedó instalado igual.';
    RETURN;
  END IF;

  BEGIN
    UPDATE cerveceriaerp.productos SET stock_actual = -1 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;

  -- El UPDATE rechazado se deshace solo: la prueba no deja nada tocado.
  IF v_ok THEN
    RAISE NOTICE 'Probado: la base rechaza dejar un producto en negativo.';
  ELSE
    -- No debería pasar nunca; si pasa, el stock quedó mal y hay que mirarlo.
    RAISE EXCEPTION 'El trigger NO rechazó el stock negativo. Revisar antes de seguir.';
  END IF;
END
$prueba$;
