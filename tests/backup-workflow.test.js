// tests/backup-workflow.test.js — Guardas del backup diario (F3-10).
// El repo es público: el backup solo puede salir encriptado y los secretos
// nunca pueden quedar en los logs. Los scripts se probaron de punta a punta
// contra Postgres local (ver el PR); acá se cuidan las reglas para el futuro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/backup.yml", import.meta.url), "utf8");
const backup = readFileSync(new URL("../scripts/backup/backup.sh", import.meta.url), "utf8");
const verificar = readFileSync(new URL("../scripts/backup/verificar.sh", import.meta.url), "utf8");

test("workflow — corre todos los días y se puede lanzar a mano", () => {
  assert.match(wf, /schedule:\s*\n\s*- cron: "\d+ \d+ \* \* \*"/);
  assert.match(wf, /workflow_dispatch:/);
});

test("workflow — los secretos solo entran por variables de entorno, nunca dentro de un comando", () => {
  for (const linea of wf.split("\n")) {
    if (linea.includes("secrets.")) assert.match(linea, /^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/, linea);
  }
});

test("workflow — verifica la restauración ANTES de guardar, y guarda solo el .gpg", () => {
  const iVerificar = wf.indexOf("scripts/backup/verificar.sh");
  const iSubir = wf.indexOf("actions/upload-artifact");
  assert.ok(iVerificar > 0 && iSubir > iVerificar);
  assert.match(wf, /path: salida\/\*\.dump\.gpg/);
  assert.match(wf, /retention-days: 30/);
  assert.match(wf, /if: github\.repository == 'tadeogiri95\/Gi-group'/, "los forks no corren el backup");
});

test("backup.sh — encripta con AES256, borra el archivo sin encriptar y falla ante cualquier error", () => {
  assert.match(backup, /set -euo pipefail/);
  assert.match(backup, /--symmetric --cipher-algo AES256/);
  assert.match(backup, /trap 'shred -u "\$PLANO"/);
  // La frase va por un descriptor de archivo, no como argumento (se vería en `ps`)
  assert.match(backup, /--passphrase-fd 3/);
  assert.ok(!/echo[^\n]*\$(SUPABASE_DB_URL|BACKUP_PASSPHRASE)/.test(backup), "no imprime secretos");
});

test("verificar.sh — controla que las tablas principales tengan datos", () => {
  assert.match(verificar, /set -euo pipefail/);
  assert.match(verificar, /for TABLA in empresa empleados fichadas/);
  assert.match(verificar, /exit 1/);
  assert.ok(!/echo[^\n]*\$(BACKUP_PASSPHRASE|VERIFY_DB_URL)/.test(verificar), "no imprime secretos");
});
