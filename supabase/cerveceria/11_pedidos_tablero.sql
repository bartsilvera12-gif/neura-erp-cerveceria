-- =============================================================================
-- 11. Columnas del tablero de Pedidos
-- =============================================================================
--
-- POR QUÉ HACE FALTA ESTO
-- El clon del schema copió la estructura pero no los datos, así que
-- `proyecto_estados` quedó vacía. El tablero de Pedidos dibuja una columna por
-- estado: sin estados no dibuja nada y la pantalla se ve rota (título arriba y
-- el resto en blanco).
--
-- QUÉ DEJA
-- Cinco columnas pensadas para una barra: el pedido entra en Pendiente, pasa a
-- En preparación, queda Listo cuando se puede servir, y cierra en Entregado.
-- Cancelado está aparte y no cuenta para el SLA.
--
-- Reglas de la app que este script respeta:
--   · Exactamente UNA columna inicial activa (`es_estado_inicial`).
--   · `tipo_sla` sólo acepta 'interno', 'cliente', 'pausado' o 'final'.
--   · `codigo` es único por empresa.
--
-- `sla_horas_objetivo` queda en NULL a propósito: el objetivo de una barra se
-- mide en minutos, no en horas, y poner un número inventado haría que el
-- tablero marque atrasos que nadie definió. Se puede cargar después desde
-- Configuración → Proyectos.
--
-- Idempotente: se puede correr más de una vez. Si ya hay columnas cargadas no
-- toca nada, para no pisar las que el cliente haya ajustado a mano.
-- =============================================================================

DO $pedidos$
DECLARE
  v_empresa CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_existentes int;
BEGIN
  SELECT count(*) INTO v_existentes
    FROM cerveceriaerp.proyecto_estados
   WHERE empresa_id = v_empresa;

  IF v_existentes > 0 THEN
    RAISE NOTICE 'El tablero ya tiene % columna(s); no se toca nada.', v_existentes;
    RETURN;
  END IF;

  INSERT INTO cerveceriaerp.proyecto_estados
    (empresa_id, codigo, nombre, descripcion, color, sort_order,
     cuenta_sla, tipo_sla, sla_horas_objetivo, es_estado_inicial, es_estado_final, activo)
  VALUES
    (v_empresa, 'pendiente',   'Pendiente',       'Pedido tomado, todavía no se empezó.',        '#94A3B8', 10, true,  'interno', NULL, true,  false, true),
    (v_empresa, 'preparacion', 'En preparación',  'Se está preparando.',                          '#F59E0B', 20, true,  'interno', NULL, false, false, true),
    (v_empresa, 'listo',       'Listo',           'Listo para servir o retirar.',                 '#0EA5E9', 30, true,  'interno', NULL, false, false, true),
    (v_empresa, 'entregado',   'Entregado',       'El cliente ya lo recibió.',                    '#10B981', 40, false, 'final',   NULL, false, true,  true),
    (v_empresa, 'cancelado',   'Cancelado',       'No se preparó ni se cobró.',                   '#EF4444', 50, false, 'final',   NULL, false, true,  true);

  RAISE NOTICE 'Tablero de Pedidos: 5 columnas creadas.';
END
$pedidos$;

-- PostgREST cachea el schema; no hace falta recargar por filas nuevas, pero no
-- molesta y cubre el caso de haber corrido otros scripts antes.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
SELECT sort_order, codigo, nombre, color, es_estado_inicial, es_estado_final, activo
  FROM cerveceriaerp.proyecto_estados
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
 ORDER BY sort_order;
-- Esperado: 5 filas, una sola con es_estado_inicial = true.
