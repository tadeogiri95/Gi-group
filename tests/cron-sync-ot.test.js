// tests/cron-sync-ot.test.js — Las OT se traen solas de la planilla cada mañana
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "secreto-cron";
});

const { GET } = await import("../app/api/cron/sync-ot/route.js");
const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");

const req = (auth) => new Request("http://localhost/api/cron/sync-ot", { headers: auth ? { authorization: auth } : {} });

test("cron sync-ot — sin CRON_SECRET devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await GET(req())).status, 401);
  assert.equal((await GET(req("Bearer otro"))).status, 401);
});

test("cron sync-ot — sincroniza cada empresa con planilla y una con error no frena a las demás", async () => {
  const subidas = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("config_sistema") && u.includes("limit=500"), respond: () => ({ status: 200, body: [
      { empresa_id: "e1", valor: { url: "https://x.example.com/a.csv" } },
      { empresa_id: "e2", valor: { url: "https://x.example.com/b.csv" } },
    ] }) },
    { match: (u, o) => u.includes("config_sistema") && u.includes("empresa_id=eq.e1") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: "https://x.example.com/a.csv" } }] }) },
    { match: (u, o) => u.includes("config_sistema") && u.includes("empresa_id=eq.e2") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: "https://x.example.com/b.csv" } }] }) },
    { match: (u) => u === "https://x.example.com/a.csv", respond: () => ({ status: 200, body: "OT,Cliente\nM-1,Ana\nM-2,Luis" }) },
    { match: (u) => u === "https://x.example.com/b.csv", respond: () => ({ status: 404, body: "no" }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: (u, o) => { subidas.push(...JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => o?.method === "PATCH" || u.includes("cron_ejecuciones"), respond: () => ({ status: 200, body: null }) },
  ]);
  const res = await GET(req("Bearer secreto-cron"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true, empresas: 2, conError: 1 });
  assert.deepEqual(subidas.map(r => r.ot), ["M-1", "M-2"]);
});

test("cron sync-ot — está en vercel.json y en el monitoreo de crons", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some(c => c.path === "/api/cron/sync-ot"));
  assert.ok(CRONS_ESPERADOS["sync-ot"]);
});
