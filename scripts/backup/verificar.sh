#!/usr/bin/env bash
# scripts/backup/verificar.sh — Comprueba que un backup se puede abrir y
# restaurar: lo desencripta, lo carga en un Postgres vacío y cuenta filas de
# las tablas principales. Si algo falla, termina con error (y GitHub avisa).
#
#   VERIFY_DB_URL       Postgres vacío donde restaurar (en CI, un contenedor)
#   BACKUP_PASSPHRASE   la misma frase del backup
#   PG_RESTORE / PSQL   binarios (por defecto: pg_restore / psql)
# Uso: verificar.sh <archivo.dump.gpg>
set -euo pipefail

ARCHIVO="${1:?Uso: verificar.sh <archivo.dump.gpg>}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"
: "${VERIFY_DB_URL:?Falta VERIFY_DB_URL}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"

PLANO="$(mktemp)"
trap 'shred -u "$PLANO" 2>/dev/null || rm -f "$PLANO"' EXIT
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt --output "$PLANO" "$ARCHIVO" 3<<<"$BACKUP_PASSPHRASE"

# Lo que Supabase trae de fábrica y el esquema public puede referenciar
"$PSQL" "$VERIFY_DB_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
create or replace function auth.role() returns text language sql stable as 'select null::text';
create or replace function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
SQL

# Sin --exit-on-error: detalles propios de Supabase pueden dar avisos; lo que
# importa es que los datos estén. Eso se comprueba abajo.
"$PG_RESTORE" --dbname="$VERIFY_DB_URL" --no-owner --no-privileges "$PLANO" 2> restore.log || true
AVISOS=$(grep -c "error:" restore.log || true)
echo "Restauración terminada (avisos de pg_restore: $AVISOS)"

for TABLA in empresa empleados fichadas; do
  N=$("$PSQL" "$VERIFY_DB_URL" -tA -v ON_ERROR_STOP=1 -c "select count(*) from public.$TABLA")
  echo "  $TABLA: $N filas"
  if [ "$TABLA" != "fichadas" ] && [ "$N" -lt 1 ]; then
    echo "::error::La tabla $TABLA quedó vacía al restaurar el backup"
    cat restore.log
    exit 1
  fi
done
echo "Backup verificado"
