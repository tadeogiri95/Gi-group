// tests/sync-confiable.test.js — Botones de Sincronizar: traen la copia más
// nueva de Google, esperan a un libro pesado y reintentan; la sincronización
// de la mañana hace OT y stock a la vez.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "secreto-cron";
});

const { descargarCsv, urlSinCache } = await import("../app/lib/syncOt.js");
const { syncAtrasada, AVISO_DEMORA_GOOGLE } = await import("../app/lib/stock.js");
const { GET } = await import("../app/api/cron/sync-ot/route.js");

const PUB = "https://docs.google.com/spreadsheets/d/e/x/pub?gid=1&single=true&output=csv";

test("urlSinCache — a Google le pide la copia más nueva sin perder los parámetros; otros links quedan igual", () => {
  const u = new URL(urlSinCache(PUB, 123));
  assert.equal(u.searchParams.get("_gypi"), "123");
  assert.equal(u.searchParams.get("gid"), "1");
  assert.equal(u.searchParams.get("output"), "csv");
  assert.equal(urlSinCache("https://x.example.com/a.csv?firma=abc", 123), "https://x.example.com/a.csv?firma=abc");
});

test("descargarCsv — si Google da un error 5xx reintenta una vez", async () => {
  let pedidos = 0;
  global.fetch = createFetchMock([
    { match: (u) => u.startsWith(PUB), respond: () => (++pedidos === 1 ? { status: 503, body: "ocupado" } : { status: 200, body: "OT\nM-1" }) },
  ]);
  assert.equal(await descargarCsv(PUB, { pausaMs: 0 }), "OT\nM-1");
  assert.equal(pedidos, 2);
});

test("descargarCsv — un 404 (link mal o sin publicar) no se reintenta", async () => {
  let pedidos = 0;
  global.fetch = createFetchMock([{ match: () => true, respond: () => { pedidos++; return { status: 404, body: "no" }; } }]);
  await assert.rejects(descargarCsv(PUB, { pausaMs: 0 }), /HTTP 404/);
  assert.equal(pedidos, 1);
});

test("descargarCsv — si tarda demasiado dos veces lo dice en castellano", async () => {
  let pedidos = 0;
  global.fetch = async () => {
    pedidos++;
    const e = new Error("The operation was aborted due to timeout");
    e.name = "TimeoutError";
    throw e;
  };
  await assert.rejects(descargarCsv(PUB, { pausaMs: 0 }), /tardó demasiado/);
  assert.equal(pedidos, 2);
});

test("descargarCsv — espera 25 s, no 10", () => {
  const src = readFileSync(new URL("../app/lib/syncOt.js", import.meta.url), "utf8");
  assert.match(src, /ESPERA_CSV_MS = 25000/);
});

test("syncAtrasada — avisa si la última sincronización es de hace más de 26 h", () => {
  const ahora = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(syncAtrasada("2026-10-22T09:00:00Z", ahora), false);
  assert.equal(syncAtrasada("2026-10-21T09:00:00Z", ahora), true);
  assert.equal(syncAtrasada(null, ahora), false);
  assert.match(AVISO_DEMORA_GOOGLE, /5 minutos/);
});

test("cron sync-ot — el stock se sincroniza aunque las OT fallen", async () => {
  const subidos = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("clave=eq.proyectos_csv_url") && u.includes("limit=500"), respond: () => ({ status: 500, body: "caída" }) },
    { match: (u) => u.includes("clave=eq.stock_csv_url") && u.includes("limit=500"), respond: () => ({ status: 200, body: [
      { empresa_id: "e1", valor: { inventario: "https://x.example.com/inv.csv" } },
    ] }) },
    { match: (u, o) => u.includes("clave=eq.stock_csv_url") && u.includes("empresa_id=eq.e1") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { inventario: "https://x.example.com/inv.csv" } }] }) },
    { match: (u) => u === "https://x.example.com/inv.csv", respond: () => ({ status: 200, body: "SKU,ARTICULO,STOCK TOTAL\nA1,Tornillo,10" }) },
    { match: (u, o) => u.includes("articulos_stock?on_conflict") && o?.method === "POST", respond: (u, o) => { subidos.push(...JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => o?.method === "PATCH", respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await GET(new Request("http://localhost/api/cron/sync-ot", { headers: { authorization: "Bearer secreto-cron" } }));
  assert.equal(res.status, 500, "las OT fallaron");
  assert.deepEqual(subidos.map((a) => a.sku), ["A1"], "pero el stock quedó copiado");
});

test("rutas y pantallas — tiempo para el botón de OT, error claro si se corta y Compras recarga artículos", () => {
  const ruta = readFileSync(new URL("../app/api/proyectos/sync-csv/route.js", import.meta.url), "utf8");
  assert.match(ruta, /export const maxDuration = 60/);
  const ot = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(ot, /sync-csv[\s\S]{0,200}res\.json\(\)\.catch/);
  assert.match(ot, /AVISO_DEMORA_GOOGLE/);
  const compras = readFileSync(new URL("../app/components/ComprasScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(compras, /if \(!pidiendo \|\| articulos\.length\) return/);
});
