#!/usr/bin/env bash
# Levanta un Postgres descartable con el schema del circuito y lo deja listo
# para `npm run test:circuito`.
#
# No toca ninguna base real: crea un cluster nuevo en un directorio temporal.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="${CIRCUITO_DIR:-/tmp/pgcircuito}"
PUERTO="${CIRCUITO_PUERTO:-5440}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"

# Si quedó un cluster de una corrida anterior, pararlo antes de borrarlo:
# si no, el puerto sigue tomado y el initdb nuevo no puede levantar.
if [ -d "$DIR/data" ]; then
  (su postgres -c "$PGBIN/pg_ctl -D $DIR/data -m immediate stop" || $PGBIN/pg_ctl -D "$DIR/data" -m immediate stop) >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$DIR"; mkdir -p "$DIR"
if id postgres >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  COMO="su postgres -c"; chown postgres:postgres "$DIR"
else
  COMO="bash -c"
fi

$COMO "$PGBIN/initdb -D $DIR/data -U postgres -A trust" >/dev/null
$COMO "$PGBIN/pg_ctl -D $DIR/data -o \"-k $DIR -p $PUERTO -c listen_addresses='127.0.0.1'\" -l $DIR/pg.log start" >/dev/null
sleep 1

# El fixture arma el schema base; los scripts 06 y 08 son los REALES del repo,
# así que correrlos acá también los prueba.
for f in "$AQUI/01-schema.sql" \
         "$RAIZ/supabase/cerveceria/06_recetas_precio_y_formatos.sql" \
         "$RAIZ/supabase/cerveceria/08_produccion_lotes_fermentadores.sql" \
         "$AQUI/02-seed.sql"; do
  cp "$f" "$DIR/$(basename "$f")"
  [ "$COMO" = "su postgres -c" ] && chown postgres:postgres "$DIR/$(basename "$f")"
  $COMO "psql -h $DIR -p $PUERTO -U postgres -q -v ON_ERROR_STOP=1 -f $DIR/$(basename "$f")"
done

echo "Postgres del circuito listo en 127.0.0.1:$PUERTO"
echo "Correr:  npm run test:circuito"
echo "Parar:   $PGBIN/pg_ctl -D $DIR/data stop"
