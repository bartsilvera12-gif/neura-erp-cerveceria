#!/usr/bin/env bash
# El caso del usuario: correr el 15 habiendo corrido solo hasta el 08.
set -uo pipefail
PGBIN=/usr/lib/postgresql/16/bin; DIR=/tmp/pgsin12; PUERTO=5442
AQUI=/home/user/neura-erp-cerveceria/scripts/carga-planillas
RAIZ=/home/user/neura-erp-cerveceria
[ -d "$DIR/data" ] && (su postgres -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true) && sleep 1
rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres:postgres "$DIR" 2>/dev/null || true
su postgres -c "$PGBIN/initdb -D $DIR/data -U postgres -A trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $DIR/data -o \"-k $DIR -p $PUERTO -c listen_addresses='127.0.0.1'\" -l $DIR/pg.log start" >/dev/null
sleep 1
P="psql -h 127.0.0.1 -p $PUERTO -U postgres -q"
$P -c "CREATE DATABASE t" >/dev/null
P="$P -d t"
$P -v ON_ERROR_STOP=1 -f "$AQUI/base.sql" >/dev/null
$P -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/cerveceria/06_recetas_precio_y_formatos.sql" >/dev/null
$P -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/cerveceria/07_receta_coven_blonde_ale.sql" >/dev/null
$P -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/cerveceria/08_produccion_lotes_fermentadores.sql" >/dev/null
echo "--- ahora el 15 SIN haber corrido el 12:"
$P -f "$RAIZ/supabase/cerveceria/15_compras_historicas.sql" 2>&1 | grep -E "ERROR|DETALLE|HINT" | head -3
echo "--- compras que quedaron (tiene que ser 0):"
$P -tAc "SELECT count(*) FROM cerveceriaerp.compras" 
(su postgres -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true)
