#!/usr/bin/env bash
# scripts/staging/actualizar.sh — Pone al día una base de staging YA PREPARADA
# (preparar.sh): vuelve a aplicar, en orden, todas las migraciones posteriores
# a la línea base. Las migraciones están escritas para poder correrse más de
# una vez, así que las que ya estaban no cambian nada y las nuevas se agregan.
# Nunca copia datos de producción. Lo usa .github/workflows/actualizar-staging.yml.
#
#   STAGING_DB_URL   base destino (variable de entorno, nunca argumento)
#   PROD_DB_URL      opcional: si se pasa, se verifica que NO sea la misma base
#   PSQL             binario de psql (por defecto: psql)
set -euo pipefail

PSQL="${PSQL:-psql}"
: "${STAGING_DB_URL:?Falta STAGING_DB_URL}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
ULTIMA_EN_BASE="$(sed -nE 's/^ULTIMA_EN_BASE=([0-9]+).*/\1/p' "$(dirname "$0")/preparar.sh")"

source "$(dirname "$0")/comun.sh"
STAGING_DB_URL="$(limpiar_url "$STAGING_DB_URL")"
[ -n "${PROD_DB_URL:-}" ] && PROD_DB_URL="$(limpiar_url "$PROD_DB_URL")"
chequear_no_es_produccion

q() { "$PSQL" "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(q -tA -c "select to_regclass('public.empresa') is not null")" != "t" ]; then
  echo "::error::La base de staging está vacía. Primero corré \"Preparar base de staging\" (auditoria/como-armar-staging.md)."
  exit 1
fi

echo "Migraciones posteriores a la $(printf '%03d' "$ULTIMA_EN_BASE")"
aplicadas=0
for f in "$RAIZ"/supabase/migrations/[0-9][0-9][0-9]_*.sql; do
  n=$((10#$(basename "$f" | cut -c1-3)))
  if [ "$n" -gt "$ULTIMA_EN_BASE" ]; then
    echo "   - $(basename "$f")"
    q -f "$f" > /dev/null
    aplicadas=$((aplicadas + 1))
  fi
done
echo "   ($aplicadas aplicadas)"

GRANTS=$(q -tA -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")
if [ "$GRANTS" -ne 0 ]; then
  echo "::error::Quedaron permisos de anon/authenticated sobre tablas ($GRANTS)"
  exit 1
fi
echo "Staging al día"
