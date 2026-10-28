# Provisión del schema `cerveceriaerp`

Scripts para pegar en el **SQL Editor** de Supabase, **en este orden**.
Ejecutar con un rol administrador (`postgres` / `supabase_admin`).

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_crear_schema_cerveceriaerp.sql` | Clona la **estructura** de `reservacaacupe` en `cerveceriaerp`. Sin datos. |
| 2 | `02_seed_cerveceriaerp.sql` | Empresa propia, sucursal, catálogo de módulos y usuario `admin@cerveceria.com`. |
| 3 | `03_usuario_auth.sql` | Crea el login en Supabase Auth y lo enlaza con el usuario del ERP. |

Después, **a mano** en Supabase: `Settings → API → Exposed schemas` → agregar
`cerveceriaerp` (PostgREST no ve el schema hasta que esté expuesto).

## Identificadores fijos

| | |
|---|---|
| `empresa_id` | `0cbefe95-4007-402c-97de-70147f9d39bb` |
| `sucursal_id` (Casa Central) | `37907a1a-5283-4b65-ae4e-4254924a1a82` |
| Usuario admin | `admin@cerveceria.com` — rol `admin` |

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
