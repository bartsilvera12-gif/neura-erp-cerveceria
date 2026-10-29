#!/usr/bin/env bash
# Levanta un Postgres descartable, arma lo minimo que el script 12 necesita y
# lo corre DOS veces para comprobar que es idempotente.
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR=/tmp/pgcarga; PUERTO=5441
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$(cd "$AQUI/../.." && pwd)"

if [ -d "$DIR/data" ]; then
  (su postgres -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" || true) >/dev/null 2>&1
  sleep 1
fi
rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres:postgres "$DIR" 2>/dev/null || true
COMO="su postgres -c"; [ "$(id -u)" = "0" ] || COMO="bash -c"
$COMO "$PGBIN/initdb -D $DIR/data -U postgres -A trust" >/dev/null
$COMO "$PGBIN/pg_ctl -D $DIR/data -o \"-k $DIR -p $PUERTO -c listen_addresses='127.0.0.1'\" -l $DIR/pg.log start" >/dev/null
sleep 1
export PGPASSWORD=
PSQL="psql -h 127.0.0.1 -p $PUERTO -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "CREATE DATABASE carga" >/dev/null
PSQL="$PSQL -d carga"
$PSQL -f "$AQUI/base.sql"
$PSQL -f "$RAIZ/supabase/cerveceria/06_recetas_precio_y_formatos.sql" >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/07_receta_coven_blonde_ale.sql"   >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/08_produccion_lotes_fermentadores.sql" >/dev/null
echo "--- corrida 1"
$PSQL -f "$RAIZ/supabase/cerveceria/12_carga_coven_planillas.sql" >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/13_inventario_fabrica.sql"    >/dev/null
# El caso que fallo en produccion: el 15 corrido sin los proveedores cargados.
# `compras.proveedor_id` es NOT NULL, asi que el 15 tiene que crearlos solo.
echo "--- se borran los proveedores a proposito"
$PSQL -c "DELETE FROM cerveceriaerp.proveedor_productos" >/dev/null
$PSQL -c "DELETE FROM cerveceriaerp.proveedores" >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/15_compras_historicas.sql"   >/dev/null
echo "--- corrida 2 (idempotencia)"
$PSQL -f "$RAIZ/supabase/cerveceria/12_carga_coven_planillas.sql" >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/13_inventario_fabrica.sql"    >/dev/null
$PSQL -f "$RAIZ/supabase/cerveceria/15_compras_historicas.sql"   >/dev/null
echo "--- comprobaciones"
psql -h 127.0.0.1 -p $PUERTO -U postgres -d carga -v ON_ERROR_STOP=1 -f "$AQUI/comprobar.sql"
(su postgres -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" || true) >/dev/null 2>&1
