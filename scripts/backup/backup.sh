#!/usr/bin/env bash
# scripts/backup/backup.sh — Copia de la base (esquema public: estructura + datos)
# encriptada con una frase secreta (F3-10). La usa .github/workflows/backup.yml.
#
# Entrada (variables de entorno, nunca argumentos: no deben quedar en logs):
#   SUPABASE_DB_URL     cadena de conexión de Supabase (Session pooler)
#   BACKUP_PASSPHRASE   frase con la que se encripta el archivo
#   PG_DUMP             binario de pg_dump (por defecto: pg_dump)
# Salida: <directorio>/gypi-AAAA-MM-DD.dump.gpg
set -euo pipefail

DESTINO="${1:-.}"
PG_DUMP="${PG_DUMP:-pg_dump}"
: "${SUPABASE_DB_URL:?Falta el secreto SUPABASE_DB_URL}"
: "${BACKUP_PASSPHRASE:?Falta el secreto BACKUP_PASSPHRASE}"

FECHA="$(date -u +%F)"
PLANO="$(mktemp)"
trap 'shred -u "$PLANO" 2>/dev/null || rm -f "$PLANO"' EXIT

# Solo el esquema public (los datos de Gypi). Sin dueños ni permisos, para que
# se pueda restaurar en cualquier Postgres (otro proyecto de Supabase o local).
"$PG_DUMP" "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges \
  --format=custom --compress=9 --file="$PLANO"

mkdir -p "$DESTINO"
SALIDA="$DESTINO/gypi-$FECHA.dump.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --output "$SALIDA" "$PLANO" 3<<<"$BACKUP_PASSPHRASE"

echo "Backup listo: $(basename "$SALIDA") ($(du -h "$SALIDA" | cut -f1))"
