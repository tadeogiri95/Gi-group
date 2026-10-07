// tests/lib-cron-monitor.test.js — Monitoreo de crons (F3-12)
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { conMonitoreoCron, cronsAtrasados, CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");

function capturar() {
  const registros = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes("/rest/v1/cron_ejecuciones")) {
      registros.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
      return new Response(null, { status: 201 });
    }
    throw new Error("fetch inesperado: " + url);
  };
  return registros;
}

const req = new Request("http://localhost/api/cron/x");

test("conMonitoreoCron — corrida OK registra ultima_ok y limpia el error (upsert por nombre)", async () => {
  const registros = capturar();
  const GET = conMonitoreoCron("auto-fichaje", async () => Response.json({ ok: true }));
  const res = await GET(req);
  assert.equal(res.status, 200);
  assert.equal(registros.length, 1);
  assert.ok(registros[0].url.includes("on_conflict=nombre"));
  assert.match(registros[0].headers.Prefer, /merge-duplicates/);
  assert.equal(registros[0].body.nombre, "auto-fichaje");
  assert.ok(registros[0].body.ultima_ok);
  assert.equal(registros[0].body.ultimo_error, null);
});

test("conMonitoreoCron — respuesta 5xx registra el error y NO actualiza ultima_ok", async () => {
  const registros = capturar();
  const GET = conMonitoreoCron("vencer-trials", async () => Response.json({ error: "x" }, { status: 500 }));
  const res = await GET(req);
  assert.equal(res.status, 500);
  assert.equal(registros[0].body.ultimo_error, "HTTP 500");
  assert.equal(registros[0].body.ultima_ok, undefined);
});

test("conMonitoreoCron — una excepción se registra y se relanza", async () => {
  const registros = capturar();
  const GET = conMonitoreoCron("refresh-scores", async () => { throw new Error("se cayó"); });
  await assert.rejects(() => GET(req), /se cayó/);
  assert.equal(registros[0].body.ultimo_error, "se cayó");
});

test("conMonitoreoCron — una llamada sin autorización (401) no se registra", async () => {
  const registros = capturar();
  const GET = conMonitoreoCron("auto-fichaje", async () => Response.json({ error: "No autorizado" }, { status: 401 }));
  await GET(req);
  assert.equal(registros.length, 0);
});

test("conMonitoreoCron — si no puede registrar, el cron igual responde", async () => {
  global.fetch = async () => { throw new Error("base caída"); };
  const GET = conMonitoreoCron("auto-fichaje", async () => Response.json({ ok: true }));
  const res = await GET(req);
  assert.equal(res.status, 200);
});

const AHORA = Date.parse("2026-10-06T12:00:00Z");
const hace = (horas) => new Date(AHORA - horas * 3600_000).toISOString();
const todosOk = () => Object.keys(CRONS_ESPERADOS).map((nombre) => ({ nombre, ultima_ok: hace(1) }));

test("cronsAtrasados — todos al día: ninguno", () => {
  assert.deepEqual(cronsAtrasados(todosOk(), AHORA), []);
});

test("cronsAtrasados — un cron diario sin correr hace 30 h está atrasado", () => {
  const filas = todosOk().map((f) => f.nombre === "auto-fichaje" ? { ...f, ultima_ok: hace(30) } : f);
  assert.deepEqual(cronsAtrasados(filas, AHORA), ["auto-fichaje"]);
});

test("cronsAtrasados — los de lunes a viernes toleran el fin de semana (72 h)", () => {
  const filas = todosOk().map((f) => f.nombre === "push-ausencias" ? { ...f, ultima_ok: hace(72) } : f);
  assert.deepEqual(cronsAtrasados(filas, AHORA), []);
});

test("cronsAtrasados — el semanal tolera 7 días", () => {
  const filas = todosOk().map((f) => f.nombre === "limpiar-tokens" ? { ...f, ultima_ok: hace(7 * 24) } : f);
  assert.deepEqual(cronsAtrasados(filas, AHORA), []);
});

test("cronsAtrasados — un cron esperado sin fila o sin ultima_ok cuenta como atrasado", () => {
  const filas = todosOk().filter((f) => f.nombre !== "reconciliacion-mp").map((f) => f.nombre === "trial-reminder" ? { ...f, ultima_ok: null } : f);
  assert.deepEqual(cronsAtrasados(filas, AHORA).sort(), ["reconciliacion-mp", "trial-reminder"]);
});

test("CRONS_ESPERADOS — coincide con los crons de vercel.json y cada uno está envuelto", async () => {
  const fs = await import("node:fs");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const nombres = vercel.crons.map((c) => c.path.replace("/api/cron/", "")).sort();
  assert.deepEqual(Object.keys(CRONS_ESPERADOS).sort(), nombres);
  for (const nombre of nombres) {
    const dir = new URL(`../app/api/cron/${nombre}/`, import.meta.url);
    const archivo = fs.readdirSync(dir).find((f) => f.startsWith("route."));
    const src = fs.readFileSync(new URL(archivo, dir), "utf8");
    assert.ok(src.includes(`conMonitoreoCron("${nombre}"`), `${nombre} no está envuelto con conMonitoreoCron`);
  }
  const sql = fs.readFileSync(new URL("../supabase/migrations/072_cron_ejecuciones.sql", import.meta.url), "utf8");
  for (const nombre of nombres) assert.ok(sql.includes(`'${nombre}'`), `la migración 072 no siembra ${nombre}`);
});
