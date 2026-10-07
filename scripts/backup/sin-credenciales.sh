#!/usr/bin/env bash
# scripts/backup/sin-credenciales.sh — Falla si un archivo contiene algo con
# forma de credencial. Se corre antes de publicar cualquier exportación en el
# repo (que es público). No imprime el valor encontrado, solo la línea.
# Uso: sin-credenciales.sh <archivo>...
set -euo pipefail

PATRONES=(
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'   # JWT (anon/service key, tokens)
  'postgres(ql)?://[^:@/ ]+:[^@/ ]+@'             # cadena de conexión con contraseña
  '(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}'      # claves de API tipo Stripe
  're_[A-Za-z0-9]{20,}'                           # Resend
  'APP_USR-[0-9-]{10,}'                           # Mercado Pago
  'AKIA[0-9A-Z]{16}'                              # AWS
  'AIza[0-9A-Za-z_-]{30,}'                        # Google
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'            # claves privadas
)

encontrado=0
for archivo in "$@"; do
  for patron in "${PATRONES[@]}"; do
    if lineas=$(grep -nE -- "$patron" "$archivo" | cut -d: -f1 | tr '\n' ' '); [ -n "$lineas" ]; then
      echo "::error::Posible credencial en $archivo (líneas: $lineas). No se publica."
      encontrado=1
    fi
  done
done
[ "$encontrado" -eq 0 ] && echo "Sin credenciales a la vista"
exit "$encontrado"
