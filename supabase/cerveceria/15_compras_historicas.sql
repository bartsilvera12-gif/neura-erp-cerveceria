-- =============================================================================
-- 15. Compras historicas de las planillas de coccion
-- =============================================================================
--
-- POR QUE HACE FALTA
-- El costeo de una receta multiplica cantidad x `costo_promedio` del insumo, y
-- ese costo lo llena el ERP con las compras. Sin ninguna compra cargada todo el
-- costeo da 0 y el precio sugerido no existe. Las planillas de coccion tienen
-- el precio de cada insumo de cada lote: son las compras que faltaban.
--
-- QUE DEJA
--   · 15 compras (129 lineas), una por lote, con su fecha y proveedor.
--   · El movimiento de ENTRADA de cada linea.
--   · El movimiento de SALIDA del consumo de ese lote.
--   · `costo_promedio` de 23 insumos.
--   · La relacion proveedor-producto con su costo habitual.
--
-- EL STOCK NO QUEDA INFLADO
-- Cada fila de las planillas es lo que se COMPRO PARA ese lote, asi que compra
-- y consumo son la misma cantidad. Por eso el script carga las dos puntas: lo
-- que entra por la compra sale por el cocimiento. Si cargara solo las compras,
-- el deposito quedaria con 1.400 kg de malta que se uso hace meses.
--
-- SOBRE EL IVA: las planillas traen un importe y nada mas, sin discriminar.
-- Las compras entran como `exenta` con IVA 0 porque inventar un 10% seria
-- fabricar un dato fiscal. NO USAR estas compras para el libro de IVA; estan
-- para costear. Se reconocen por el `numero_control`, que empieza con HIST-.
--
-- EL COSTO QUE QUEDA es el de la ULTIMA compra de cada insumo, que es lo que
-- hace el ERP cuando se carga una compra desde la pantalla (no promedia, pese
-- al nombre de la columna). Asi el numero es el mismo venga de donde venga.
--
-- Idempotente: las compras se saltean por `numero_control`.
-- Solo toca el schema `cerveceriaerp`.
-- =============================================================================

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;

DO $compras$
DECLARE
  v_empresa  CONSTANT uuid := '0cbefe95-4007-402c-97de-70147f9d39bb';
  v_sucursal CONSTANT uuid := '37907a1a-5283-4b65-ae4e-4254924a1a82';
  c          record;
  l          record;
  v_prov     uuid;
  v_prod     uuid;
  v_nombre   text;
  v_sku      text;
  v_n        int := 0;
  v_extra_c  text := '';
  v_extra_v  text := '';
  r          record;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Columnas obligatorias que este script no conoce
  -- ---------------------------------------------------------------------------
  -- `compras` tiene bastantes columnas NOT NULL que la pantalla de Compras
  -- llena y que una carga historica no tiene (nro_timbrado, por ejemplo: estas
  -- compras no vienen de una factura). Enumerarlas a mano era adivinar de a
  -- una y fallar de a una, asi que se las busca en el catalogo y se las
  -- rellena con el vacio que corresponde a su tipo.
  FOR r IN
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'cerveceriaerp'
       AND table_name   = 'compras'
       AND is_nullable  = 'NO'
       AND column_default IS NULL
       AND column_name NOT IN (
         'empresa_id','sucursal_id','proveedor_id','proveedor_nombre',
         'producto_id','producto_nombre','cantidad','moneda','tipo_cambio',
         'costo_unitario_original','costo_unitario','iva_tipo','subtotal',
         'monto_iva','total','precio_venta','margen_venta','tipo_pago',
         'numero_control','estado','fecha','fecha_factura','metodo_pago',
         'usuario_nombre')
     ORDER BY ordinal_position
  LOOP
    v_extra_c := v_extra_c || ', ' || quote_ident(r.column_name);
    v_extra_v := v_extra_v || ', ' || CASE
      WHEN r.data_type IN ('character varying','text','character')     THEN ''''''
      WHEN r.data_type IN ('numeric','integer','bigint','smallint',
                           'double precision','real')                  THEN '0'
      WHEN r.data_type = 'boolean'                                      THEN 'false'
      WHEN r.data_type IN ('timestamp with time zone',
                           'timestamp without time zone')               THEN 'now()'
      WHEN r.data_type = 'date'                                         THEN 'CURRENT_DATE'
      WHEN r.data_type IN ('json','jsonb')                              THEN '''{}''::jsonb'
      -- Un uuid NOT NULL sin default apunta a otra tabla: no se puede inventar.
      ELSE NULL
    END;
    IF v_extra_v IS NULL THEN
      RAISE EXCEPTION 'La columna compras.% (%) es obligatoria y no se puede completar sola.',
        r.column_name, r.data_type;
    END IF;
    RAISE NOTICE 'compras.% es obligatoria y no la trae la planilla: se completa vacia.',
      r.column_name;
  END LOOP;
  FOR c IN
    SELECT * FROM (VALUES
      ('HIST-G-01', 'COC-G-01', '2026-08-23'::date, 'Mercado Craft',
       '[{"sku":"MP-PILSEN","cantidad":103.33,"costo":8600.0,"total":888638.0,"origen":"PILSEN UMA x103.33"},{"sku":"MP-VIENNA","cantidad":5.0,"costo":11000.0,"total":55000.0,"origen":"VIENNA UMA x5"},{"sku":"MP-CARACLAIR","cantidad":4.17,"costo":22300.0,"total":92991.0,"origen":"CARACLAIR x4.17"},{"sku":"LU-CASCADE","cantidad":400.0,"costo":508.0,"total":203200.0,"origen":"CASCADE 200G x2"},{"sku":"LV-US05","cantidad":500.0,"costo":1422.0,"total":711000.0,"origen":"US-05 500G x1"},{"sku":"LU-CASCADE","cantidad":50.0,"costo":538.0,"total":26900.0,"origen":"CASCADE 50G x1"},{"sku":"LU-HALLER","cantidad":500.0,"costo":484.0,"total":242000.0,"origen":"TRADITION 500GR x1"},{"sku":"CL-IRISH","cantidad":50.0,"costo":500.0,"total":25000.0,"origen":"CLARIFICANTE x50"}]'::jsonb),
      ('HIST-G-02', 'COC-G-02', '2026-08-27'::date, 'Mercado Craft',
       '[{"sku":"MP-PILSEN","cantidad":82.5,"costo":8600.0,"total":709500.0,"origen":"PILSEN UMA x82.5"},{"sku":"MP-VIENNA","cantidad":14.1,"costo":11000.0,"total":155100.0,"origen":"VIENNA UMA x14.1"},{"sku":"MP-CARACLAIR","cantidad":7.4,"costo":22300.0,"total":165020.0,"origen":"CLARA CLAIR x7.4"},{"sku":"LU-MAGNUM","cantidad":200.0,"costo":505.0,"total":101000.0,"origen":"MAGNUM 200GR x1"},{"sku":"LU-MAGNUM","cantidad":50.0,"costo":540.0,"total":27000.0,"origen":"MAGNUM 50GR x1"},{"sku":"LU-CENTENNIAL","cantidad":200.0,"costo":508.0,"total":101600.0,"origen":"CENTENIAL 200GR x1"},{"sku":"LU-CENTENNIAL","cantidad":50.0,"costo":538.0,"total":26900.0,"origen":"CENTENIAL 50GR x1"},{"sku":"LU-AMARILLO","cantidad":400.0,"costo":608.0,"total":243200.0,"origen":"AMARILLO 200GR x2"},{"sku":"LU-CITRACRYO","cantidad":2000.0,"costo":445.0,"total":890000.0,"origen":"CITRA CRYO 1 LITRO x2"},{"sku":"LV-NEWE","cantidad":11.0,"costo":63545.454545,"total":699000.0,"origen":"NEW E 11GR x1"},{"sku":"CL-IRISH","cantidad":50.0,"costo":500.0,"total":25000.0,"origen":"CLARIFICANTE x50"}]'::jsonb),
      ('HIST-G-03', 'COC-G-03', '2026-08-09'::date, 'Mercado Craft',
       '[{"sku":"MP-PILSEN","cantidad":42.84,"costo":8600.0,"total":368424.0,"origen":"PILSEN UMA x42.84"},{"sku":"MP-VIENNA","cantidad":10.88,"costo":10000.0,"total":108800.0,"origen":"VIENNA UMA x10.88"},{"sku":"MP-MELANOID","cantidad":10.2,"costo":11000.0,"total":112200.0,"origen":"MALTA MLANOIDINA UMA x10.2"},{"sku":"MP-CARA30","cantidad":4.08,"costo":11000.0,"total":44880.0,"origen":"MALTA CARA 30 UMA x4.08"},{"sku":"LU-CENTENNIAL","cantidad":600.0,"costo":508.0,"total":304800.0,"origen":"CENTENIAL 200GR x3"},{"sku":"LV-US05","cantidad":500.0,"costo":1422.0,"total":711000.0,"origen":"SAFALE USA 05 500G x1"},{"sku":"CL-IRISH","cantidad":50.0,"costo":500.0,"total":25000.0,"origen":"CLARIFICANTE x50"}]'::jsonb),
      ('HIST-P-02', 'COC-P-02', '2025-11-27'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":7.5,"costo":13000.0,"total":97500.0,"origen":"PILSEN 7.5kg"},{"sku":"MP-MUNICH","cantidad":0.3,"costo":15000.0,"total":4500.0,"origen":"MUNICH 300g"},{"sku":"MP-VIENNA","cantidad":0.3,"costo":15000.0,"total":4500.0,"origen":"VIENNA 300g"},{"sku":"MP-CARAPILS","cantidad":0.3,"costo":15000.0,"total":4500.0,"origen":"CARAPILS 300g"},{"sku":"MP-CARAMEL20","cantidad":0.3,"costo":20000.0,"total":6000.0,"origen":"CARAMELO 20 300g"},{"sku":"LU-CASCADE","cantidad":30.0,"costo":500.0,"total":15000.0,"origen":"CASCADE 30g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"E.K. GOLDING 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":2608.695652,"total":60000.0,"origen":"US-05 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-03', 'COC-P-03', '2025-12-03'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-VIENNA","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"VIENNA 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPILS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"E.K. GOLDING 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"US-05 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-04', 'COC-P-04', '2025-12-03'::date, 'Cerveshopp',
       '[{"sku":"MP-PALEALE","cantidad":6.0,"costo":14000.0,"total":84000.0,"origen":"PALE ALE 6kg"},{"sku":"MP-MUNICH","cantidad":0.75,"costo":15333.333333,"total":11500.0,"origen":"MUNICH 750g"},{"sku":"MP-CARAMEL60","cantidad":0.75,"costo":20000.0,"total":15000.0,"origen":"CARAMELO 60 750g"},{"sku":"LU-CASCADE","cantidad":30.0,"costo":500.0,"total":15000.0,"origen":"CASCADE 30g"},{"sku":"LU-CASCADE","cantidad":20.0,"costo":500.0,"total":10000.0,"origen":"CASCADE 20g"},{"sku":"LU-CASCADE","cantidad":20.0,"costo":500.0,"total":10000.0,"origen":"CASCADE 20g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"US-05 2un"}]'::jsonb),
      ('HIST-P-05', 'COC-P-05', '2025-12-17'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-VIENNA","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"VIENNA 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPILS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"E.K. GOLDING 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"US-05 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-06', 'COC-P-06', '2026-01-07'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-07', 'COC-P-07', '2026-02-27'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-08', 'COC-P-08', '2026-01-08'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":5.4,"costo":13055.555556,"total":70500.0,"origen":"PILSEN 5.4kg"},{"sku":"MP-VIENNA","cantidad":0.9,"costo":15000.0,"total":13500.0,"origen":"VIENNA 900g"},{"sku":"MP-CARAPILS","cantidad":0.45,"costo":15555.555556,"total":7000.0,"origen":"CARAPLIS 450g"},{"sku":"LU-MAGNUM","cantidad":10.0,"costo":1000.0,"total":10000.0,"origen":"MAGNUM 10g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":600.0,"total":15000.0,"origen":"CASCADE 25g"},{"sku":"LU-AMARILLO","cantidad":30.0,"costo":1000.0,"total":30000.0,"origen":"AMARILLO 30g"},{"sku":"LU-CASCADE","cantidad":20,"costo":800.0,"total":16000.0,"origen":"CASCAD20G+AMARI20G (partido)"},{"sku":"LU-AMARILLO","cantidad":20,"costo":800.0,"total":16000.0,"origen":"CASCAD20G+AMARI20G (partido)"},{"sku":"ES-NARANJA","cantidad":25.0,"costo":200.0,"total":5000.0,"origen":"CASCARA DE NARANJA 25g"},{"sku":"ES-CEDRON","cantidad":15.0,"costo":200.0,"total":3000.0,"origen":"CEDRON KAPII 15g"},{"sku":"ES-CEDRON","cantidad":5.0,"costo":400.0,"total":2000.0,"origen":"CEDRON KAPII 5g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"US-05 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-09', 'COC-P-09', '2026-02-27'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-10', 'COC-P-10', '2026-04-10'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-11', 'COC-P-11', '2026-04-10'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-12', 'COC-P-12', '2026-04-26'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb),
      ('HIST-P-13', 'COC-P-13', '2026-04-26'::date, 'Cerveshopp',
       '[{"sku":"MP-PILSEN","cantidad":6.5,"costo":13000.0,"total":84500.0,"origen":"PILSEN 6.5kg"},{"sku":"MP-MUNICH","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"MUNICH 250g"},{"sku":"MP-CARAPILS","cantidad":0.25,"costo":16000.0,"total":4000.0,"origen":"CARAPLIS 250g"},{"sku":"MP-CARAMEL20","cantidad":0.25,"costo":20000.0,"total":5000.0,"origen":"CARAMELO 20 250g"},{"sku":"LU-CASCADE","cantidad":25.0,"costo":500.0,"total":12500.0,"origen":"CASCADE 7,1% 25g"},{"sku":"LU-EKG","cantidad":15.0,"costo":1000.0,"total":15000.0,"origen":"EKG 5,7% 15g"},{"sku":"LV-US05","cantidad":23.0,"costo":3043.478261,"total":70000.0,"origen":"us-05 1,5 2un"},{"sku":"CL-WHIRLFLOC","cantidad":1.0,"costo":4000.0,"total":4000.0,"origen":"WHIRLFLOC 1un"}]'::jsonb)
    ) AS t(numero, lote, fecha, proveedor, lineas)
  LOOP
    -- Idempotencia: si la compra ya esta, no se vuelve a cargar ni a mover stock.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM cerveceriaerp.compras
       WHERE empresa_id = v_empresa AND numero_control = c.numero
    );

    -- `compras.proveedor_id` es NOT NULL, asi que el proveedor no es opcional:
    -- si no esta, se crea. Antes este script asumia que ya lo habia dejado el
    -- 12 y, cuando no, fallaba recien en el INSERT con un error de constraint
    -- que no dice que hacer.
    SELECT id INTO v_prov FROM cerveceriaerp.proveedores
     WHERE empresa_id = v_empresa AND upper(trim(nombre)) = upper(trim(c.proveedor))
     LIMIT 1;

    IF v_prov IS NULL THEN
      BEGIN
        INSERT INTO cerveceriaerp.proveedores (empresa_id, nombre, estado, observaciones)
        VALUES (v_empresa, c.proveedor, 'activo',
                'Creado por la carga de compras historicas. Falta el RUC.')
        RETURNING id INTO v_prov;
        RAISE NOTICE 'Proveedor % creado (no estaba).', c.proveedor;
      EXCEPTION WHEN unique_violation THEN
        -- Existe con otra grafia que el cotejo de arriba no alcanzo. Se busca
        -- de nuevo en vez de abortar la carga entera.
        SELECT id INTO v_prov FROM cerveceriaerp.proveedores
         WHERE empresa_id = v_empresa AND upper(trim(nombre)) = upper(trim(c.proveedor))
         LIMIT 1;
      END;
    END IF;

    IF v_prov IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver ni crear el proveedor "%".', c.proveedor;
    END IF;

    FOR l IN SELECT * FROM jsonb_array_elements(c.lineas) AS x(j)
    LOOP
      SELECT id, nombre, sku INTO v_prod, v_nombre, v_sku
        FROM cerveceriaerp.productos
       WHERE empresa_id = v_empresa AND sucursal_id = v_sucursal
         AND sku = (l.j ->> 'sku');
      IF v_prod IS NULL THEN
        RAISE EXCEPTION 'Falta el insumo % (correr antes el script 12).', l.j ->> 'sku';
      END IF;

      EXECUTE format(
        'INSERT INTO cerveceriaerp.compras
           (empresa_id, sucursal_id, proveedor_id, proveedor_nombre,
            producto_id, producto_nombre, cantidad, moneda, tipo_cambio,
            costo_unitario_original, costo_unitario,
            iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
            tipo_pago, numero_control, estado, fecha, fecha_factura, metodo_pago,
            usuario_nombre%s)
         VALUES
           ($1, $2, $3, $4,
            $5, $6, $7, ''PYG'', 1,
            $8, $8,
            ''exenta'', $9, 0, $9, 0, 0,
            ''contado'', $10, ''registrada'', $11, $11::date, ''efectivo'',
            ''Carga historica''%s)', v_extra_c, v_extra_v)
      USING v_empresa, v_sucursal, v_prov, c.proveedor,
            v_prod, v_nombre, (l.j ->> 'cantidad')::numeric,
            (l.j ->> 'costo')::numeric, (l.j ->> 'total')::numeric,
            c.numero, c.fecha::timestamptz;

      -- Entra por la compra...
      INSERT INTO cerveceriaerp.movimientos_inventario
        (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre)
      VALUES
        (v_empresa, v_sucursal, v_prod, v_nombre, v_sku,
         'ENTRADA', (l.j ->> 'cantidad')::numeric, (l.j ->> 'costo')::numeric,
         'compra', c.numero, c.fecha::timestamptz, 'Carga historica');

      -- ...y sale por el cocimiento, el mismo dia y la misma cantidad.
      INSERT INTO cerveceriaerp.movimientos_inventario
        (empresa_id, sucursal_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, usuario_nombre)
      VALUES
        (v_empresa, v_sucursal, v_prod, v_nombre, v_sku,
         'SALIDA', (l.j ->> 'cantidad')::numeric, (l.j ->> 'costo')::numeric,
         'produccion', c.lote, c.fecha::timestamptz, 'Carga historica');

      -- A quien se le compra y a cuanto. No pisa el proveedor principal si ya hay uno.
      BEGIN
        INSERT INTO cerveceriaerp.proveedor_productos
          (empresa_id, producto_id, proveedor_id, costo_habitual, es_principal, updated_at)
        VALUES (v_empresa, v_prod, v_prov, (l.j ->> 'costo')::numeric,
                NOT EXISTS (SELECT 1 FROM cerveceriaerp.proveedor_productos pp
                             WHERE pp.empresa_id = v_empresa AND pp.producto_id = v_prod
                               AND pp.es_principal),
                now())
        ON CONFLICT (empresa_id, producto_id, proveedor_id)
        DO UPDATE SET costo_habitual = EXCLUDED.costo_habitual, updated_at = now();
      EXCEPTION WHEN undefined_table THEN
        NULL;  -- instalacion sin `proveedor_productos`: la compra igual vale
      END;
    END LOOP;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Compras historicas cargadas en esta corrida: %.', v_n;
END
$compras$;

-- ---------------------------------------------------------------------------
-- Costo de cada insumo: el de su ULTIMA compra, igual que hace la pantalla
-- ---------------------------------------------------------------------------
-- Se escribe aparte y no dentro del bucle para que el resultado no dependa del
-- orden en que se recorrieron las compras.
UPDATE cerveceriaerp.productos p
   SET costo_promedio = u.costo, updated_at = now()
  FROM (
    SELECT DISTINCT ON (producto_id) producto_id, costo_unitario AS costo
      FROM cerveceriaerp.movimientos_inventario
     WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
       AND tipo = 'ENTRADA' AND origen = 'compra'
     ORDER BY producto_id, fecha DESC, id DESC
  ) u
 WHERE p.id = u.producto_id
   AND p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb'
   AND p.costo_promedio IS DISTINCT FROM u.costo;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verificacion
-- ---------------------------------------------------------------------------
SELECT 'compras' AS que, count(*) FROM cerveceriaerp.compras
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND numero_control LIKE 'HIST-%'
UNION ALL
SELECT 'movimientos', count(*) FROM cerveceriaerp.movimientos_inventario
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND usuario_nombre = 'Carga historica'
UNION ALL
SELECT 'insumos con costo', count(*) FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND es_insumo AND costo_promedio > 0;

-- El stock de los insumos tiene que quedar como estaba: lo que entro salio.
SELECT p.sku, p.nombre, p.stock_actual, round(p.costo_promedio) AS costo
  FROM cerveceriaerp.productos p
 WHERE p.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND p.es_insumo
 ORDER BY p.sku;

-- Lo que SIGUE sin costo, si queda algo. Un insumo en 0 no rompe el costeo:
-- lo deja mas barato de lo que es, que es peor, porque no se nota.
SELECT sku, nombre
  FROM cerveceriaerp.productos
 WHERE empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND es_insumo AND coalesce(costo_promedio, 0) = 0
 ORDER BY sku;
-- Esperado: MP-CARADEX y LV-AY4, que la receta del script 07 usa pero ningun
-- lote de las planillas compro nunca. Ver docs/CARGA-PLANILLAS-COVEN.md.

-- Y el costeo de las recetas ya no da 0:
SELECT r.nombre,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_total')::numeric)    AS costo_lote,
       round((cerveceriaerp.fn_receta_costeo(r.id)->>'costo_unitario')::numeric) AS costo_por_litro
  FROM cerveceriaerp.recetas r
 WHERE r.empresa_id = '0cbefe95-4007-402c-97de-70147f9d39bb' AND r.activa
 ORDER BY r.nombre;
