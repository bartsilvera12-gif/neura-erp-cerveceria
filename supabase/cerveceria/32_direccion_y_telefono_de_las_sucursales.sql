-- =============================================================================
-- 32. La dirección y el teléfono que salen en los documentos
-- =============================================================================
--
-- EL PROBLEMA
-- El ticket salía con la dirección de otro negocio: "Ruta Pyca - Caacupé".
-- Esta instancia se clonó de la de Caacupé, y esos datos estaban escritos a
-- mano en el código. Un ticket con la dirección equivocada es peor que un
-- ticket sin dirección: el cliente que quiere volver, o reclamar, va a un
-- lugar que no existe.
--
-- COMO SE ARREGLA
-- En el código ya no hay ninguna dirección escrita a mano: ahora cada
-- SUCURSAL lleva la suya, en `doc_direccion` y `doc_telefono`. Va por sucursal
-- y no por empresa porque la cervecería y el bar no están en la misma esquina,
-- y el ticket que le queda en la mano al cliente tiene que decir dónde
-- compró.
--
-- La dirección puede tener varias líneas: se escribe un renglón por línea y
-- el documento las separa solo.
--
-- Mientras una sucursal no tenga el dato cargado, el documento sale sin esa
-- línea. Nunca con la de otro.
--
-- Idempotente: se puede correr de nuevo para corregir. Sólo toca
-- `cerveceriaerp`.
-- =============================================================================

BEGIN;

-- Por si el clon no trajo las columnas.
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_direccion text;
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_telefono  text;
ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS doc_logo_path text;

-- ---------------------------------------------------------------------------
-- CAMBIAR ACA: la dirección y el teléfono de cada sucursal
-- ---------------------------------------------------------------------------
-- Una línea de dirección por renglón. Si una sucursal usa el mismo teléfono,
-- repetilo: cada sucursal lleva el suyo.

UPDATE cerveceriaerp.sucursales
   SET doc_direccion = E'CAMBIAR: calle y número\nCAMBIAR: barrio\nVilleta - Paraguay',
       doc_telefono  = 'CAMBIAR: (09xx) xxx xxx'
 WHERE nombre ILIKE '%cervecer%';

UPDATE cerveceriaerp.sucursales
   SET doc_direccion = E'CAMBIAR: calle y número\nCAMBIAR: barrio\nVilleta - Paraguay',
       doc_telefono  = 'CAMBIAR: (09xx) xxx xxx'
 WHERE nombre ILIKE '%bar%';

COMMIT;

-- ---------------------------------------------------------------------------
-- Cómo quedó: esto es lo que va a salir impreso
-- ---------------------------------------------------------------------------
SELECT nombre        AS sucursal,
       doc_telefono  AS telefono,
       doc_direccion AS direccion
  FROM cerveceriaerp.sucursales
 ORDER BY nombre;

-- Si alguna fila sigue diciendo "CAMBIAR", ese documento todavía sale sin
-- dirección. No es un error: es que falta el dato.
