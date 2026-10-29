-- Datos del circuito. Se aplica DESPUÉS de los scripts 06 y 08, porque usa
-- `receta_formatos` (06) y `fermentadores` (08).
-- Números redondos a propósito: los resultados se pueden verificar a mano.

ALTER TABLE cerveceriaerp.sucursales ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true;
SET search_path TO cerveceriaerp;

INSERT INTO empresas (id, nombre_empresa) VALUES
 ('0cbefe95-4007-402c-97de-70147f9d39bb','Cervecería');

INSERT INTO sucursales (id, empresa_id, nombre, codigo) VALUES
 ('37907a1a-5283-4b65-ae4e-4254924a1a82','0cbefe95-4007-402c-97de-70147f9d39bb','Cervecería','CERVECERIA'),
 ('b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31','0cbefe95-4007-402c-97de-70147f9d39bb','Bar','BAR');

INSERT INTO usuarios (id, empresa_id, email, nombre, rol) VALUES
 ('11111111-2222-3333-4444-555555555555','0cbefe95-4007-402c-97de-70147f9d39bb','admin@cerveceria.com','Administrador','admin');

-- Insumos (sucursal Cervecería). Números redondos para poder verificar a mano.
INSERT INTO productos (id, empresa_id, sucursal_id, nombre, sku, unidad_medida, stock_actual, costo_promedio, es_insumo, es_vendible) VALUES
 ('a0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','MALTA PILSEN','MP-PILSEN','KG',  250, 10000, true, false),
 ('a0000000-0000-4000-8000-000000000002','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','LUPULO CASCADE','MP-CASCADE','G', 5000,    50, true, false);

-- Producto a granel (WIP) en Cervecería y su gemelo en el Bar, MISMO SKU.
INSERT INTO productos (id, empresa_id, sucursal_id, nombre, sku, unidad_medida, stock_actual, costo_promedio, es_vendible, controla_stock) VALUES
 ('b0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','COVEN BLONDE ALE A GRANEL','CV-BL-GRANEL','L', 0, 0, false, true),
 ('b0000000-0000-4000-8000-000000000002','0cbefe95-4007-402c-97de-70147f9d39bb','b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31','COVEN BLONDE ALE A GRANEL','CV-BL-GRANEL','L', 0, 0, false, true);

-- Formato envasable (chop 500 ml) en las dos sucursales, mismo SKU.
INSERT INTO productos (id, empresa_id, sucursal_id, nombre, sku, unidad_medida, stock_actual, costo_promedio, precio_venta, es_vendible) VALUES
 ('c0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','CHOP COVEN BLONDE 500','CV-BL-CHOP500','UNIDAD', 0, 0, 15000, true),
 ('c0000000-0000-4000-8000-000000000002','0cbefe95-4007-402c-97de-70147f9d39bb','b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31','CHOP COVEN BLONDE 500','CV-BL-CHOP500','UNIDAD', 0, 0, 15000, true);

-- Receta: 500 L de rendimiento.
INSERT INTO recetas (id, empresa_id, sucursal_id, producto_id, nombre, rendimiento_cantidad, rendimiento_unidad, activa) VALUES
 ('d0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','b0000000-0000-4000-8000-000000000001','Coven Blonde Ale 500 L', 500, 'L', true);

INSERT INTO receta_items (empresa_id, receta_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden) VALUES
 ('0cbefe95-4007-402c-97de-70147f9d39bb','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001', 100,'KG',0,1),
 ('0cbefe95-4007-402c-97de-70147f9d39bb','d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',1000,'G', 0,2);

-- Formato de la receta: el chop de 500 ml.
INSERT INTO receta_formatos (receta_id, empresa_id, sucursal_id, producto_id, capacidad, capacidad_unidad, orden) VALUES
 ('d0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','c0000000-0000-4000-8000-000000000001', 500, 'ML', 1);

INSERT INTO fermentadores (id, empresa_id, sucursal_id, codigo, nombre, capacidad_litros) VALUES
 ('e0000000-0000-4000-8000-000000000001','0cbefe95-4007-402c-97de-70147f9d39bb','37907a1a-5283-4b65-ae4e-4254924a1a82','F1','Fermentador 1', 1000);
