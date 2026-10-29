-- Tablas base del schema `cerveceriaerp` que toca el circuito.
-- Reconstrucción a mano, no un volcado del schema real (ver README).
-- Se aplica ANTES de los scripts 06 y 08, que agregan lo suyo encima.

CREATE SCHEMA IF NOT EXISTS cerveceriaerp;
SET search_path TO cerveceriaerp;

CREATE TABLE empresas (
  id uuid PRIMARY KEY, nombre_empresa text NOT NULL);

CREATE TABLE sucursales (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL, codigo text, maneja_caja boolean DEFAULT true,
  activo boolean NOT NULL DEFAULT true);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY, empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  email text, nombre text, rol text);

CREATE TABLE productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  nombre text NOT NULL, sku text NOT NULL,
  unidad_medida text NOT NULL DEFAULT 'UNIDAD',
  stock_actual numeric NOT NULL DEFAULT 0,
  stock_minimo numeric NOT NULL DEFAULT 0,
  costo_promedio numeric NOT NULL DEFAULT 0,
  precio_venta numeric NOT NULL DEFAULT 0,
  precio_mayorista numeric, precio_distribuidor numeric,
  metodo_valuacion text NOT NULL DEFAULT 'CPP',
  activo boolean NOT NULL DEFAULT true,
  es_vendible boolean NOT NULL DEFAULT true,
  es_insumo boolean NOT NULL DEFAULT false,
  controla_stock boolean NOT NULL DEFAULT true,
  modo_receta text NOT NULL DEFAULT 'preparado_al_vender',
  tipo_iva text NOT NULL DEFAULT '10%',
  codigo_barras text, codigo_barras_interno boolean DEFAULT false,
  imagen_path text, imagen_url text,
  categoria_principal_id uuid, ubicacion_principal_id uuid, proveedor_principal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);

CREATE TABLE recetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  rendimiento_cantidad numeric NOT NULL DEFAULT 1,
  rendimiento_unidad text,
  activa boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);

CREATE TABLE receta_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  receta_id uuid NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  insumo_producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad numeric NOT NULL, unidad_medida text,
  merma_pct numeric NOT NULL DEFAULT 0, orden int NOT NULL DEFAULT 0);

CREATE TABLE producciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  receta_id uuid, producto_id uuid, producto_nombre text,
  cantidad_fabricada numeric NOT NULL, rendimiento_cantidad numeric,
  unidad_rendimiento text, costo_total numeric, costo_unitario numeric,
  fecha timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid, usuario_nombre text, observaciones text);

CREATE TABLE produccion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produccion_id uuid NOT NULL REFERENCES producciones(id) ON DELETE CASCADE,
  insumo_producto_id uuid, insumo_nombre text, cantidad numeric,
  unidad_medida text, costo_unitario numeric, subcosto numeric);

CREATE TABLE movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sucursal_id uuid REFERENCES sucursales(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  producto_nombre text, producto_sku text,
  tipo text NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE')),
  cantidad numeric NOT NULL, costo_unitario numeric NOT NULL DEFAULT 0,
  origen text NOT NULL,
  referencia text, fecha timestamptz NOT NULL DEFAULT now(),
  produccion_id uuid REFERENCES producciones(id) ON DELETE SET NULL,
  created_by uuid, usuario_nombre text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  CONSTRAINT movimientos_inventario_origen_check CHECK (origen = ANY (ARRAY[
    'compra','venta','ajuste_manual','inventario_inicial',
    'anulacion_venta','anulacion_compra','produccion',
    'transferencia_salida','transferencia_entrada'])));

-- El guard real: si sucursal_id viene NULL se hereda del producto.
CREATE OR REPLACE FUNCTION fn_heredar_sucursal_id() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE v_suc uuid;
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.sucursal_id INTO v_suc FROM cerveceriaerp.productos p WHERE p.id = NEW.producto_id;
  NEW.sucursal_id := v_suc;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_mov_sucursal BEFORE INSERT ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_heredar_sucursal_id();
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS cerveceriaerp.modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, nombre text NOT NULL);
CREATE TABLE IF NOT EXISTS cerveceriaerp.empresa_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL, modulo_id uuid NOT NULL, activo boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, modulo_id));
CREATE OR REPLACE FUNCTION cerveceriaerp.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TABLE IF NOT EXISTS cerveceriaerp.transferencias_inventario (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  numero                text NOT NULL,
  sucursal_origen_id    uuid NOT NULL REFERENCES cerveceriaerp.sucursales(id) ON DELETE RESTRICT,
  sucursal_destino_id   uuid NOT NULL REFERENCES cerveceriaerp.sucursales(id) ON DELETE RESTRICT,
  estado                text NOT NULL DEFAULT 'pendiente',
  observacion_solicitud text,
  motivo_rechazo        text,
  solicitada_por        uuid REFERENCES cerveceriaerp.usuarios(id) ON DELETE SET NULL,
  aprobada_por          uuid REFERENCES cerveceriaerp.usuarios(id) ON DELETE SET NULL,
  despachada_por        uuid REFERENCES cerveceriaerp.usuarios(id) ON DELETE SET NULL,
  recibida_por          uuid REFERENCES cerveceriaerp.usuarios(id) ON DELETE SET NULL,
  solicitada_at         timestamptz NOT NULL DEFAULT now(),
  aprobada_at           timestamptz,
  rechazada_at          timestamptz,
  despachada_at         timestamptz,
  recibida_at           timestamptz,
  cancelada_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transferencias_numero_empresa_uq UNIQUE (empresa_id, numero),
  CONSTRAINT transferencias_estado_check CHECK (
    estado = ANY (ARRAY['pendiente','aprobada','rechazada','despachada','recibida','cancelada'])
  ),
  -- Origen y destino no pueden ser la misma sucursal.
  CONSTRAINT transferencias_origen_distinto_destino CHECK (sucursal_origen_id <> sucursal_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_transf_empresa        ON cerveceriaerp.transferencias_inventario (empresa_id);
CREATE INDEX IF NOT EXISTS idx_transf_origen         ON cerveceriaerp.transferencias_inventario (sucursal_origen_id);
CREATE INDEX IF NOT EXISTS idx_transf_destino        ON cerveceriaerp.transferencias_inventario (sucursal_destino_id);
CREATE INDEX IF NOT EXISTS idx_transf_estado         ON cerveceriaerp.transferencias_inventario (empresa_id, estado);

DROP TRIGGER IF EXISTS transferencias_inventario_updated_at ON cerveceriaerp.transferencias_inventario;
CREATE TRIGGER transferencias_inventario_updated_at
  BEFORE UPDATE ON cerveceriaerp.transferencias_inventario
  FOR EACH ROW EXECUTE FUNCTION cerveceriaerp.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) transferencias_inventario_items (líneas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cerveceriaerp.transferencias_inventario_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id            uuid NOT NULL REFERENCES cerveceriaerp.transferencias_inventario(id) ON DELETE CASCADE,
  empresa_id                  uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  -- La solicitud nace con el producto de la sucursal DESTINO (la que pide).
  producto_destino_id         uuid NOT NULL REFERENCES cerveceriaerp.productos(id) ON DELETE RESTRICT,
  -- Equivalente en la sucursal ORIGEN (mismo SKU). Nullable hasta resolverse.
  producto_origen_id          uuid REFERENCES cerveceriaerp.productos(id) ON DELETE RESTRICT,
  sku_snapshot                text,
  nombre_snapshot             text,
  unidad_snapshot             text,
  cantidad_solicitada         numeric NOT NULL,
  cantidad_aprobada           numeric NOT NULL DEFAULT 0,
  cantidad_despachada         numeric NOT NULL DEFAULT 0,
  cantidad_recibida           numeric NOT NULL DEFAULT 0,
  costo_unitario_transferencia numeric NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transf_item_cant_solicitada_pos  CHECK (cantidad_solicitada > 0),
  CONSTRAINT transf_item_cant_aprobada_nonneg CHECK (cantidad_aprobada >= 0),
  CONSTRAINT transf_item_cant_despachada_nonneg CHECK (cantidad_despachada >= 0),
  CONSTRAINT transf_item_cant_recibida_nonneg CHECK (cantidad_recibida >= 0),
  CONSTRAINT transf_item_costo_nonneg         CHECK (costo_unitario_transferencia >= 0),
  -- La aprobada nunca supera la solicitada.
  CONSTRAINT transf_item_aprobada_le_solicitada CHECK (cantidad_aprobada <= cantidad_solicitada),
  -- Un producto destino no se repite en la misma transferencia.
  CONSTRAINT transf_item_producto_uq UNIQUE (transferencia_id, producto_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_transf_item_transf   ON cerveceriaerp.transferencias_inventario_items (transferencia_id);
CREATE INDEX IF NOT EXISTS idx_transf_item_prod_dst ON cerveceriaerp.transferencias_inventario_items (producto_destino_id);
CREATE INDEX IF NOT EXISTS idx_transf_item_prod_org ON cerveceriaerp.transferencias_inventario_items (producto_origen_id);
-- Lo que el circuito no necesitaba y el script 12 si.
CREATE TABLE IF NOT EXISTS cerveceriaerp.proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL, nombre_comercial text, razon_social text, ruc text,
  telefono text, email text, direccion text, contacto text,
  estado text NOT NULL DEFAULT 'activo',
  condicion_pago text, plazo_pago_dias integer, moneda_preferida text,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);

-- Datos base: la empresa y la sucursal Cerveceria que usan los scripts 07 y 12.
INSERT INTO cerveceriaerp.empresas (id, nombre_empresa)
VALUES ('0cbefe95-4007-402c-97de-70147f9d39bb', 'Coven') ON CONFLICT DO NOTHING;
INSERT INTO cerveceriaerp.sucursales (id, empresa_id, nombre)
VALUES ('37907a1a-5283-4b65-ae4e-4254924a1a82', '0cbefe95-4007-402c-97de-70147f9d39bb', 'Cerveceria')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS cerveceriaerp.categorias_productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL, codigo text, descripcion text, parent_id uuid,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);

CREATE TABLE IF NOT EXISTS cerveceriaerp.inventario_ubicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES cerveceriaerp.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL, codigo text, tipo text NOT NULL DEFAULT 'deposito',
  parent_id uuid, descripcion text, activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);
