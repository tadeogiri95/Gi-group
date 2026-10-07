#!/usr/bin/env bash
# scripts/backup/exportar-esquema.sh — Exporta la estructura (sin datos) del
# esquema public y un inventario de extensiones y buckets de Storage.
# Lo usa .github/workflows/exportar-esquema.yml.
#
#   SUPABASE_DB_URL  cadena de conexión (variable de entorno, nunca argumento)
#   PG_DUMP / PSQL   binarios (por defecto: pg_dump / psql)
# Uso: exportar-esquema.sh <directorio>
set -euo pipefail

DESTINO="${1:?Uso: exportar-esquema.sh <directorio>}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"
: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL}"
mkdir -p "$DESTINO"

# Estructura del esquema public, con políticas y permisos (GRANT): justamente
# lo que hay que poder comparar contra las migraciones. Sin dueños.
# Se quitan las líneas \restrict / \unrestrict (llevan una clave aleatoria
# distinta en cada corrida y ensuciarían la comparación).
"$PG_DUMP" "$SUPABASE_DB_URL" --schema-only --schema=public --no-owner \
  | grep -vE '^\\(restrict|unrestrict) ' > "$DESTINO/prod-schema.sql"

# Inventario de lo que vive fuera de public y la app necesita
"$PSQL" "$SUPABASE_DB_URL" -X -q -t -A -F ' | ' -v ON_ERROR_STOP=1 > "$DESTINO/prod-inventario.sql" <<'SQL'
\echo '-- Inventario de producción (generado; no se ejecuta)'
\echo '-- Extensiones: nombre | esquema | versión'
select '-- ' || extname, extnamespace::regnamespace::text, extversion from pg_extension order by 1;
\echo '-- Buckets de Storage: id | público | límite de tamaño | tipos permitidos'
select '-- ' || id, public::text, coalesce(file_size_limit::text, '-'), coalesce(array_to_string(allowed_mime_types, ','), '-') from storage.buckets order by 1;
\echo '-- Versión del servidor'
select '-- ' || version();
SQL

echo "Exportado: $(wc -l < "$DESTINO/prod-schema.sql") líneas de esquema"
