# Provisión del schema `cerveceriaerp`

Scripts para pegar en el **SQL Editor** de Supabase, **en este orden**.
Ejecutar con un rol administrador (`postgres` / `supabase_admin`).

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_crear_schema_cerveceriaerp.sql` | Clona la **estructura** de `reservacaacupe` en `cerveceriaerp`. Sin datos. |
| 2 | `02_seed_cerveceriaerp.sql` | Empresa propia, sucursal, catálogo de módulos y usuario `admin@cerveceria.com`. |
| 3 | `03_usuario_auth.sql` | Crea el login en Supabase Auth y lo enlaza con el usuario del ERP. |
| 4 | `04_sucursales_cerveceria_bar.sql` | Dos administraciones: recrea `usuario_sucursales`, crea las sucursales Cervecería y Bar, un usuario por cada una, y el dueño con acceso a las dos. |
| 5 | `05_usuarios_auth_sucursales.sql` | Logins en Supabase Auth de los dos usuarios del paso 4. **Cambiá las contraseñas antes de correrlo.** |
| 6 | `06_recetas_precio_y_formatos.sql` | Precio en Recetas: merma de proceso, formatos de venta y precio sugerido por margen objetivo. |
| 7 | `07_receta_coven_blonde_ale.sql` | Carga la receta COVEN Blonde Ale 500 L con sus insumos y formatos. |
| 8 | `08_produccion_lotes_fermentadores.sql` | Producción por lotes: fermentadores, etapas, envasado y trazabilidad. Activa el módulo **Producción**. |
| 9 | `09_bar_presentaciones.sql` | Chop, botella y litro en el Bar: vender uno descuenta sus litros del granel. |
| 10 | `10_pago_mixto.sql` | Pago mixto en ventas: columna `pagos_desglose`, `mixto` permitido en `metodo_pago`, y el detalle de conciliación acepta una fila por método. Sin esto la parte en efectivo de un cobro mixto no entra al arqueo y la caja no cierra. |
| 11 | `11_pedidos_tablero.sql` | Columnas del tablero de Pedidos (Pendiente → En preparación → Listo → Entregado, más Cancelado). Sin esto el tablero no dibuja nada. |
| 12 | `12_carga_coven_planillas.sql` | Carga de las planillas de COVEN: 2 proveedores, 25 insumos con su costo, 4 productos a granel, 4 recetas y los 15 lotes históricos de las planillas de cocción. No mueve stock ni pisa el costo de un insumo que ya tenga compras. Supuestos y pendientes en `docs/CARGA-PLANILLAS-COVEN.md`. |
| 13 | `13_inventario_fabrica.sql` | Inventario de planta: 57 artículos de ferretería y repuestos con su ubicación física. Carga stock con un movimiento `inventario_inicial`; los 10 artículos que la planilla no contó quedan sin control de stock en vez de en cero. |
| 14 | `14_costeo_operacion_packaging.sql` | Costeo completo: líneas de costo de hacer el lote (mano de obra, energía, overhead), costos de envasado por formato y los márgenes objetivo por canal. El cálculo vive en `src/lib/recetas/costeo-completo.ts`. |
| 15 | `15_compras_historicas.sql` | Las 15 compras (129 líneas) que están en las planillas de cocción, con su entrada y la salida del consumo del lote, así el stock no queda inflado. Llena el `costo_promedio` de 23 insumos: sin eso el costeo de las recetas da 0. Requiere el 12. |
| 16 | `16_proveedor_ruc_unico.sql` | Índice único de RUC por empresa, comparando sin guiones ni espacios. La app ya chequeaba el duplicado, pero dos pedidos simultáneos pasaban los dos. Si ya hay duplicados, los lista en vez de fallar. |

El paso 4 crea la **ficha** de cada usuario en el ERP; el **login** lo crean el
3 (para el dueño) y el 5 (para los dos operativos). Sin el login, el usuario
existe pero no puede entrar.

Después, **a mano** en Supabase: `Settings → API → Exposed schemas` → agregar
`cerveceriaerp` (PostgREST no ve el schema hasta que esté expuesto).

## Identificadores fijos

| | |
|---|---|
| `empresa_id` | `0cbefe95-4007-402c-97de-70147f9d39bb` |
| `sucursal_id` (Casa Central) | `37907a1a-5283-4b65-ae4e-4254924a1a82` |
| Usuario admin | `admin@cerveceria.com` — rol `admin`, acceso a las dos sucursales |
| `sucursal_id` (Bar) | `b31f0c2e-9a7d-4f55-8c10-2d6e4a9b7f31` (lo crea el paso 4) |

## Dos administraciones en un mismo negocio

El paso 4 deja la cervecería y el bar como sucursales separadas.

**Separado por sucursal:** productos, categorías, recetas, movimientos de
inventario, ventas, compras, órdenes de compra, gastos, presupuestos, facturas,
notas de crédito, pagos, cuentas por cobrar y por pagar, y caja. El SKU y el
código de barras son únicos *por sucursal*, así que cada administración arma su
catálogo sin pisar al otro.

**Compartido:** clientes, proveedores y el padrón de usuarios.

**Entre sucursales:** el módulo Reposición mueve stock de una a otra con su
circuito de solicitud y recepción.

El ERP de origen había creado `usuario_sucursales` y después la borró, porque
ese cliente definió "un usuario, una sucursal". Acá el paso 4 la recrea, con
los mismos privilegios que `sucursales` para que PostgREST la exponga. Cada
tabla responde una pregunta distinta y no se pisan: `usuario_sucursales` dice
a **qué** sucursales puede entrar el usuario, y `sucursal_predeterminada_id`
con **cuál** arranca la sesión.

Cada usuario operativo entra sólo a su sucursal. El dueño
(`admin@cerveceria.com`) figura en las dos y cambia de una a otra con el
selector del header.

### Vista consolidada

El selector trae además **Consolidado**, que suma las dos sucursales. Es de
**sólo lectura**: desde ahí no se puede vender, comprar, mover stock ni
facturar, porque esas operaciones necesitan una sucursal concreta.

| | Consolidado |
|---|---|
| Dashboard | suma las dos |
| Estado de cuenta, Ventas, Compras, Conciliación, Proveedores | suman las dos |
| Caja y arqueo, Cierres de caja | por sucursal — se ocultan |
| Proyección de inventario, Inventario crítico | por sucursal — se ocultan |
| Libro IVA y R90 | ya cubrían la empresa entera (son fiscales, por RUC) |

Los de caja y stock no se consolidan a propósito: los arqueos son de cada
turno de cada sucursal, y el mismo SKU existe en las dos como filas distintas,
así que sumarlos daría un número sin significado. El paso 4
trae los emails de los dos usuarios operativos como variables: **ajustalos
antes de correrlo**, y creales el login igual que en el paso 3.

## Aislamiento

- Los pasos 1 y 2 **sólo escriben dentro de `cerveceriaerp`**. `reservacaacupe`,
  `public`, `storage` y el resto se leen pero nunca se modifican.
- El paso 3 inserta un usuario nuevo en `auth.users` / `auth.identities`, que es
  el schema compartido de Supabase Auth. Es la única excepción y no toca ninguna
  fila existente. Se puede evitar creando el usuario desde Studio
  (*Authentication → Add user*) y corriendo sólo el **PASO 2** de ese archivo.
- Las FKs que en el origen salen del schema (p. ej. a `auth.users`) se clonan
  apuntando al mismo destino; las internas se reapuntan a `cerveceriaerp`.

## Notas

- El paso 1 es re-ejecutable: lo que ya existe se saltea con un `NOTICE`.
  Revisá la pestaña de mensajes del SQL Editor: ahí aparece cualquier objeto que
  no se haya podido clonar.
- Al final de cada script hay un `SELECT` de verificación. En el paso 1 los
  conteos de ambos schemas deberían coincidir.
- Las secuencias arrancan desde su valor inicial, no desde el del origen
  (el schema queda vacío).
- Las vistas materializadas se crean `WITH NO DATA`.

## Verificación hecha

Los tres scripts se probaron sobre PostgreSQL 16 contra un schema de prueba con
enums, dominios, tipos compuestos, `serial`, `IDENTITY`, columnas generadas,
arrays, `jsonb`, PK/UNIQUE/CHECK/EXCLUDE, índices parciales y por expresión con
nombre propio, FKs internas y hacia `auth.users`, vistas anidadas, vista
materializada, triggers, RLS con policies, grants a `anon`/`authenticated`/
`service_role`, privilegios por defecto y comentarios.

El `pg_dump --schema-only` del clon resultó **idéntico** al del origen (salvo el
nombre del schema). Las únicas limitaciones conocidas:

- Agregados (`CREATE AGGREGATE`) y tablas particionadas no se clonan; el script
  avisa por `NOTICE` si encuentra alguno.
- Una columna **generada** cuya expresión llame a una función del schema origen
  queda apuntando ahí (Postgres 16 no permite reescribir esa expresión). El
  script lo avisa por `NOTICE`.
