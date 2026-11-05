-- =============================================================================
-- 32. La dirección y el teléfono que salen en los documentos
-- =============================================================================
--
-- EL PROBLEMA
-- El ticket salía con la dirección de otro negocio: "Ruta Pyca - Caacupé".
-- Esta instancia se clonó de la de Caacupé y esos datos estaban escritos a
-- mano en el código. Un ticket con la dirección equivocada es peor que un
-- ticket sin dirección: el cliente que quiere volver, o reclamar, va a un
-- lugar que no existe.
--
-- COMO QUEDO
-- En el código ya no hay ninguna dirección escrita a mano, y el documento no
-- imprime la línea que no tiene. Así que HOY EL TICKET SALE SIN DIRECCION, que
-- es lo correcto mientras no esté el dato real.
--
-- Cada SUCURSAL lleva la suya en `doc_direccion` y `doc_telefono`. Va por
-- sucursal y no por empresa porque la cervecería y el bar no están en la misma
-- esquina, y el ticket que le queda en la mano al cliente tiene que decir
-- dónde compró.
--
-- Este script hace dos cosas, en este orden:
--   PASO 1 — mira qué hay cargado hoy (y borra lo que haya quedado del clon).
--   PASO 2 — carga la dirección de verdad. ESTA COMENTADO: se descomenta el
--            día que estén los datos.
--
-- Idempotente. Sólo toca `cerveceriaerp`.
-- =============================================================================

BEGIN;

-- Por si el clon no trajo las columnas.
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_direccion text;
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_telefono  text;
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_logo_path text;

-- ---------------------------------------------------------------------------
-- PASO 1 — Que no quede nada heredado
-- ---------------------------------------------------------------------------
-- Si el clon arrastró la dirección de Caacupé en alguna sucursal, se va. Vacío
-- es el estado correcto: el documento sale sin la línea, nunca con la de otro.
UPDATE cerveceriaerp.sucursales
   SET doc_direccion = NULL
 WHERE doc_direccion IS NOT NULL
   AND (doc_direccion ILIKE '%caacup%' OR doc_direccion ILIKE '%cordillera%');

COMMIT;

-- ---------------------------------------------------------------------------
-- PASO 2 — El día que estén los datos (hoy está comentado a propósito)
-- ---------------------------------------------------------------------------
-- Una línea de dirección por renglón: el \n las separa y el documento las
-- muestra una debajo de la otra. Descomentar, poner los datos de verdad y
-- correr. Mientras tenga textos de relleno, MEJOR NO CORRERLO: lo que se
-- escriba acá es lo que se imprime en el ticket, tal cual.
--
-- BEGIN;
--
-- UPDATE cerveceriaerp.sucursales
--    SET doc_direccion = E'<calle y número>\n<barrio>\nVilleta - Paraguay',
--        doc_telefono  = '<(09xx) xxx xxx>'
--  WHERE nombre ILIKE '%cervecer%';
--
-- UPDATE cerveceriaerp.sucursales
--    SET doc_direccion = E'<calle y número>\n<barrio>\nVilleta - Paraguay',
--        doc_telefono  = '<(09xx) xxx xxx>'
--  WHERE nombre ILIKE '%bar%';
--
-- COMMIT;

-- ---------------------------------------------------------------------------
-- Qué se está imprimiendo hoy
-- ---------------------------------------------------------------------------
-- Las dos columnas en NULL es lo esperado por ahora: ticket sin dirección.
SELECT nombre        AS sucursal,
       doc_telefono  AS telefono,
       doc_direccion AS direccion
  FROM cerveceriaerp.sucursales
 ORDER BY nombre;
