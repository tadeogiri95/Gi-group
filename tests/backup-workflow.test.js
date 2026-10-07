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

// ─── Exportación del esquema (F3-09 / F0-05) ───

const wfEsquema = readFileSync(new URL("../.github/workflows/exportar-esquema.yml", import.meta.url), "utf8");
const sinCred = readFileSync(new URL("../scripts/backup/sin-credenciales.sh", import.meta.url), "utf8");
const exportar = readFileSync(new URL("../scripts/backup/exportar-esquema.sh", import.meta.url), "utf8");

test("exportar-esquema — solo a mano, sin datos, y revisa credenciales ANTES de subir", () => {
  assert.match(wfEsquema, /on:\s*\n\s*workflow_dispatch:/);
  assert.ok(!/schedule:/.test(wfEsquema), "no corre solo");
  assert.match(exportar, /--schema-only --schema=public/);
  const iRevisar = wfEsquema.indexOf("scripts/backup/sin-credenciales.sh");
  const iPush = wfEsquema.indexOf("git push");
  assert.ok(iRevisar > 0 && iPush > iRevisar);
  for (const linea of wfEsquema.split("\n")) {
    if (linea.includes("secrets.")) assert.match(linea, /^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/, linea);
  }
});

test("sin-credenciales.sh — detecta JWT, cadenas de conexión con contraseña y claves privadas", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "cred-"));
  const script = new URL("../scripts/backup/sin-credenciales.sh", import.meta.url).pathname;
  const corre = (contenido) => {
    const f = join(dir, `f${Math.random()}.sql`);
    writeFileSync(f, contenido);
    try { execFileSync("bash", [script, f], { stdio: "pipe" }); return 0; } catch (e) { return e.status; }
  };
  assert.equal(corre("CREATE TABLE empleados (password text);\n"), 0, "una columna llamada password no es una credencial");
  assert.equal(corre("-- eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma\n"), 1);
  assert.equal(corre("-- postgresql://postgres.abc:Clave123@aws-0.pooler.supabase.com:5432/postgres\n"), 1);
  assert.equal(corre("-----BEGIN PRIVATE KEY-----\n"), 1);
  assert.match(sinCred, /set -euo pipefail/);
});

// ─── Línea base y staging (F3-11) ───

const wfStaging = readFileSync(new URL("../.github/workflows/preparar-staging.yml", import.meta.url), "utf8");
const preparar = readFileSync(new URL("../scripts/staging/preparar.sh", import.meta.url), "utf8");
const base = readFileSync(new URL("../supabase/baseline/esquema-base.sql", import.meta.url), "utf8");

test("preparar-staging — solo a mano, secretos por env y con chequeo contra producción", () => {
  assert.match(wfStaging, /on:\s*\n\s*workflow_dispatch:/);
  assert.ok(!/schedule:/.test(wfStaging));
  for (const linea of wfStaging.split("\n")) {
    if (linea.includes("secrets.")) assert.match(linea, /^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/, linea);
  }
  assert.match(wfStaging, /PROD_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(preparar, /apunta a producción/);
  assert.match(preparar, /ya tiene tablas de Gypi/);
});

test("línea base — sin datos, sin credenciales, sin supabase_admin y con anon cerrado como en producción", () => {
  assert.ok(!/^COPY /m.test(base) && !/^INSERT INTO /m.test(base), "no debe traer datos");
  assert.ok(!base.includes("FOR ROLE supabase_admin"));
  assert.ok(!base.includes("transaction_timeout"));
  assert.match(base, /REVOKE ALL ON TABLES FROM anon, authenticated;/);
  assert.match(base, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;/);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(base));
  // Las tablas que usa la app tienen que estar
  for (const t of ["empresa", "empleados", "fichadas", "solicitudes", "sesiones", "cron_ejecuciones"]) {
    assert.match(base, new RegExp(`CREATE TABLE public\\.${t} \\(`), t);
  }
});

test("línea base — la última migración que incluye es la que dice preparar.sh", async () => {
  const { readdirSync } = await import("node:fs");
  const ultima = Number(preparar.match(/ULTIMA_EN_BASE=(\d+)/)[1]);
  const nums = readdirSync(new URL("../supabase/migrations/", import.meta.url)).map((f) => Number(f.slice(0, 3))).filter(Number.isFinite);
  assert.ok(nums.includes(ultima), `existe la migración ${ultima}`);
});
