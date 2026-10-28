# Cervecería ERP

Instancia dedicada (monocliente) del ERP Zentra/Neura, clonada desde
`reserva-ecologica-caacupe-erp`. Repositorio, base de datos y despliegue son
**totalmente independientes** del ERP de origen.

| | |
|---|---|
| URL | http://cerveceria.neura.com.py |
| Schema Postgres | `cerveceriaerp` |
| Usuario admin | `admin@cerveceria.com` |
| Stack | Next.js 15 (App Router) + Supabase self-hosted + Coolify (Dockerfile) |

## Aislamiento

- Todo el acceso a datos pasa por `NEURA_CLIENT_SCHEMA` (ver `src/lib/supabase/schema.ts`),
  que por defecto vale `cerveceriaerp`. La app nunca escribe en `public` ni en el schema
  de otro cliente.
- El schema `cerveceriaerp` se crea con los scripts de `supabase/cerveceria/`
  (clon estructural de `reservacaacupe`, sin datos).
- La empresa tiene su propio `empresa_id` (UUID), generado al correr el seed.

## Variables de entorno

| Variable | Valor |
|---|---|
| `NEURA_CLIENT_SCHEMA` | `cerveceriaerp` |
| `NEURA_CLIENT_NAME` | `Cervecería` |
| `NEURA_INSTANCE_MODE` | `single_client` |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del Supabase self-hosted |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `SUPABASE_DB_URL` | cadena de conexión Postgres directa |
| `SIFEN_SECRETS_KEY` | clave de cifrado de credenciales SIFEN |
| `NODE_OPTIONS` | `--max-old-space-size=2048` |

Hace falta exponer `cerveceriaerp` en Supabase → Settings → API → *Exposed schemas*.

## Desarrollo

```bash
npm ci
npm run dev
```

## Build de producción

Imagen standalone de Next (`Dockerfile`), igual que el ERP de origen.
