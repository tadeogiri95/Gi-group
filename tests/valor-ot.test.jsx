// tests/valor-ot.test.jsx — El valor de cada OT, igual en toda la app (Tadeo,
// 23/11): primero el PRECIO del Plan de trabajo y, si no tiene, estimado por
// los materiales cargados como necesidad de la OT (materiales ÷ % de
// materiales, 30 % por defecto). Lo usan la lista y el detalle de OT, la
// Planificación, el Panel de Producción y la Minuta.
import "./helpers/domSetup.js";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { combinarValores } from "../app/lib/finanzasOtClientes.js";
import { produccionDeSemana, enProceso } from "../app/lib/panelProduccion.js";
import { informeMinutas } from "../app/lib/minutasReporte.js";
import { textoValorOt } from "../app/lib/valorizacion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/valor-ot/route.js");
const E = "00000000-0000-0000-0000-0000000000e1";
const token = async (rol = "gerencial") => (await signAccessToken({ empleadoId: "00000000-0000-0000-0000-000000000001", empresaId: E, legajo: 1, rol })).token;
const reqGet = (t) => new Request("http://localhost/api/valor-ot", { headers: { Authorization: `Bearer ${t}` } });

test("combinarValores — el PRECIO del Plan manda; sin precio, materiales ÷ factor marcado estimado; sin nada, afuera", () => {
  const v = combinarValores({
    precios: new Map([["A", 5000], ["Z", 0]]),
    materiales: new Map([["A", { total: 900 }], ["B", { total: 300 }], ["C", { total: 0 }]]),
    factor: 0.3,
  });
  assert.deepEqual(v.get("A"), { valor: 5000, estimado: false }, "con precio no se estima aunque tenga materiales");
  assert.deepEqual(v.get("B"), { valor: 1000, estimado: true });
  assert.equal(v.has("C"), false, "sin precio ni materiales no tiene valor");
  assert.equal(v.has("Z"), false);
  // El % de Finanzas → Configuración cambia la estimación
  assert.equal(combinarValores({ materiales: new Map([["B", { total: 300 }]]), factor: 0.25 }).get("B").valor, 1200);
  assert.equal(textoValorOt(1000, true, (n) => `$ ${n}`), "≈ $ 1000 estimado");
  assert.equal(textoValorOt(1000, false, (n) => `$ ${n}`), "$ 1000");
});

test("/api/valor-ot — solo quien ve precios; precio del Plan o estimado por materiales", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/precios_ot?"), respond: () => ({ status: 200, body: [{ ot: "A", precio: 5000 }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "A", created_at: "2026-11-01T12:00:00Z" }, { ot: "B", created_at: "2026-11-01T12:00:00Z" }, { ot: "C", created_at: "2026-11-01T12:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock?"), respond: (u) => ({ status: 200, body: decodeURIComponent(u).includes('"B"') ? [{ ot: "B", sku: "X", cantidad: 2 }] : [] }) },
    { match: (u) => u.includes("/rest/v1/precios_fijos_ot?"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/v_precios_articulos?"), respond: () => ({ status: 200, body: [{ sku: "X", fecha: "2026-01-01", precio_ars: 150 }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema?"), respond: () => ({ status: 200, body: [] }) },
  ]);
  assert.equal((await api.GET(reqGet(await token("operativo")))).status, 403, "los operarios no ven valores");
  const res = await api.GET(reqGet(await token()));
  assert.equal(res.status, 200);
  const { valores } = await res.json();
  assert.deepEqual(valores.sort(), [["A", 5000, 0], ["B", 1000, 1]], "B: 2 × $150 = $300 ÷ 30 % = $1000 estimado; C sin materiales queda afuera");
});

test("Panel de Producción — $ producidos y en proceso separan lo estimado", () => {
  const SEMANA = { desde: "2026-11-16", hasta: "2026-11-22" };
  const porOt = new Map([
    ["1", { ot: "1", fin: "2026-11-18T15:00:00Z", etapas: [] }],
  ]);
  const precios = new Map([["1", 1000], ["2", 400], ["3", 300]]);
  const columnas = [{ id: "corte", nombre: "Corte", tarjetas: [{ ot: "2", estado: "en_curso" }, { ot: "3", estado: "esperando", lleva: 1 }] }];
  const r = enProceso(columnas, precios, new Set(["3"]));
  assert.deepEqual([r.valor, r.valorEstimado], [700, 300]);
  assert.equal(enProceso(columnas, null).valorEstimado, null, "sin permiso no hay $");
  assert.equal(produccionDeSemana(porOt, [], SEMANA, null).valorEstimado, null);
});

test("Minuta — la OT terminada sin PRECIO lleva su valor estimado marcado", () => {
  const r = informeMinutas({
    minutas: [{ id: 1, fecha: "2026-11-20" }],
    items: [
      { id: "t1", minuta_id: 1, seccion: "prod_terminada", ot: "7858" },
      { id: "t2", minuta_id: 1, seccion: "prod_terminada", ot: "7900" },
      { id: "t3", minuta_id: 1, seccion: "inst_terminada", ot: "7000" },
    ],
    precios: { 7858: 1500000, 7900: 500000 }, estimadas: ["7900"], hoy: "2026-11-20", modo: "dia",
  });
  const t = Object.fromEntries(r.terminado.items.map((x) => [x.ot, x]));
  assert.deepEqual([t["7858"].valor, t["7858"].estimado], [1500000, false]);
  assert.deepEqual([t["7900"].valor, t["7900"].estimado], [500000, true]);
  assert.deepEqual([t["7000"].valor, t["7000"].estimado], [null, false]);
  assert.equal(r.terminado.produccion.valor, 2000000);
});

test("las pantallas de Producción toman el valor de /api/valor-ot, no de precios_ot directo", () => {
  const leer = (p) => readFileSync(new URL(`../app/${p}`, import.meta.url), "utf8");
  assert.match(leer("lib/valorizacion.js"), /apiFetch\("\/api\/valor-ot"\)/);
  assert.doesNotMatch(leer("lib/valorizacion.js"), /precios_ot\?/);
  assert.doesNotMatch(leer("lib/panelProduccionServidor.js"), /precios_ot\?/);
  assert.doesNotMatch(leer("api/minutas/route.js"), /precios_ot\?/);
  assert.match(leer("components/DetalleOp.jsx"), /Valor ≈ \{fmtPesos\(precio\)\} estimado/);
});
