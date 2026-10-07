#!/usr/bin/env bash
# scripts/staging/preparar.sh — Deja una base VACÍA de Supabase idéntica en
# estructura a producción (F3-11): línea base + migraciones posteriores a la
# 072 + carpetas de Storage. Sin datos de producción.
# Lo usa .github/workflows/preparar-staging.yml.
#
#   STAGING_DB_URL   base destino (variable de entorno, nunca argumento)
#   PROD_DB_URL      opcional: si se pasa, se verifica que NO sea la misma base
#   PSQL             binario de psql (por defecto: psql)
set -euo pipefail

PSQL="${PSQL:-psql}"
: "${STAGING_DB_URL:?Falta STAGING_DB_URL}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
ULTIMA_EN_BASE=72   # la línea base ya incluye hasta la migración 072

# Corrige errores de copiado comunes: espacios o saltos de línea, comillas y un
# "NOMBRE=" adelante (Supabase muestra la dirección como DATABASE_URL=... en
# algunas pestañas).
limpiar_url() {
  local u
  u="$(printf '%s' "$1" | tr -d '\r\n' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^[A-Za-z_][A-Za-z0-9_]*=//')"
  u="${u#\"}"; u="${u%\"}"; u="${u#\'}"; u="${u%\'}"
  printf '%s' "$u"
}

# Identificador del proyecto: "postgres.<ref>@" (pooler) o "@db.<ref>." (directa)
ref_de() { sed -nE 's#^postgres(ql)?://postgres\.([a-z0-9]+):.*#\2#p; s#^postgres(ql)?://[^@]+@db\.([a-z0-9]+)\..*#\2#p' <<<"$1" | head -1; }

# Forma de la dirección SIN la contraseña (usuario@servidor), para el registro
sin_clave() { sed -nE 's#^(postgres(ql)?)://([^:@/]+)(:[^@]*)?@([^/?]+).*#\1://\3:***@\5#p' <<<"$1" | head -1; }

STAGING_DB_URL="$(limpiar_url "$STAGING_DB_URL")"
[ -n "${PROD_DB_URL:-}" ] && PROD_DB_URL="$(limpiar_url "$PROD_DB_URL")"

if [ -n "${PROD_DB_URL:-}" ]; then
  REF_STG="$(ref_de "$STAGING_DB_URL")"; REF_PROD="$(ref_de "$PROD_DB_URL")"
  echo "Staging:    $(sin_clave "$STAGING_DB_URL" || true) → proyecto: ${REF_STG:-(no reconocido)}"
  echo "Producción: $(sin_clave "$PROD_DB_URL" || true) → proyecto: ${REF_PROD:-(no reconocido)}"
  if [ -z "$REF_STG" ]; then
    echo "::error::No reconozco la dirección de STAGING_DB_URL. Tiene que empezar con postgresql:// (Supabase → Connect → Session pooler). No se toca nada."
    exit 1
  fi
  if [ "$REF_STG" = "$REF_PROD" ] || [ "$STAGING_DB_URL" = "$PROD_DB_URL" ]; then
    echo "::error::STAGING_DB_URL es el mismo proyecto que producción ($REF_PROD). Usá la dirección del proyecto gypi-staging. No se toca nada."
    exit 1
  fi
fi

q() { "$PSQL" "$STAGING_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(q -tA -c "select to_regclass('public.empresa') is not null")" = "t" ]; then
  echo "::error::La base de staging ya tiene tablas de Gypi. Este proceso es solo para una base vacía (no borra nada)."
  exit 1
fi

echo "1/4 Línea base del esquema"
q -f "$RAIZ/supabase/baseline/esquema-base.sql" > /dev/null

echo "2/4 Migraciones posteriores a la $(printf '%03d' $ULTIMA_EN_BASE)"
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

echo "3/4 Carpetas de Storage (con los límites de la migración 070)"
q <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documentos-empleado', 'documentos-empleado', false, 5242880, array['application/pdf','image/png','image/jpeg','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('logos', 'logos', true, 2097152, array['image/png','image/jpeg','image/webp']),
  ('reportes-obra', 'reportes-obra', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
SQL

echo "4/4 Verificación"
TABLAS=$(q -tA -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
GRANTS=$(q -tA -c "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")
echo "   tablas: $TABLAS · permisos de anon/authenticated sobre tablas: $GRANTS"
if [ "$TABLAS" -lt 31 ] || [ "$GRANTS" -ne 0 ]; then
  echo "::error::La base de staging no quedó como se esperaba"
  exit 1
fi
echo "Staging listo"
