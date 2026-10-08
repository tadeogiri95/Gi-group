#!/usr/bin/env bash
# scripts/staging/comun.sh — Funciones compartidas por preparar.sh y
# actualizar.sh: limpiar la dirección pegada, mostrarla sin la contraseña y
# frenar si apunta a producción. Se usa con `source`.

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

# Frena (exit 1) si STAGING_DB_URL no se reconoce o es el mismo proyecto que producción
chequear_no_es_produccion() {
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
}
