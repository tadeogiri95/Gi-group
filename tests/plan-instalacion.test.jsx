// tests/plan-instalacion.test.jsx — Plan de instalación confirmado (parte 44,
// migración 154; /api/plan-instalacion): gestión confirma el plan, cada
// instalador ve sus obras en 📅 Mis instalaciones y el Gantt avisa cuánto se
// corrió cada obra.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { itemsDelPlan, finConfirmadoPorOt, conCorrimiento, misDias } from "../app/lib/planInstalacion.js";
import { planInstalacionBody } from "../app/lib/schemas.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { MisInstalaciones } = await import("../app/components/screens/InstalacionesScreen.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/plan-instalacion/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const YO = "22222222-2222-4222-8222-222222222222";
const OTRO = "33333333-3333-4333-8333-333333333333";

const obra = (clave, ots, tramos, equipo = [YO, OTRO], extra = {}) => ({ clave, ots: ots.map((ot) => ({ ot })), tramos, equipo, fin: tramos.at(-1)?.fecha, ...extra });

test("itemsDelPlan — un renglón por medio día e instalador; sin lugar no entra; instaladores sin id quedan vacíos", () => {
  const items = itemsDelPlan([
    obra("a|maipu", ["1", "2"], [{ fecha: "2026-11-09", medio: 0 }, { fecha: "2026-11-09", medio: 1 }]),
    obra("ot:3", ["3"], [{ fecha: "2026-11-10", medio: 0 }], ["virtual-1"]),
    obra("ot:4", ["4"], [], [YO], { sinLugar: true }),
  ]);
  assert.equal(items.length, 5);
  assert.deepEqual(items[0], { obra: "a|maipu", ots: ["1", "2"], fecha: "2026-11-09", medio: 0, empleado_id: YO, orden: 0 });
  assert.equal(items[4].empleado_id, null);
  assert.equal(items[4].orden, 1);
  assert.equal(planInstalacionBody.safeParse({ division_id: "muebles", items }).success, true);
  assert.equal(planInstalacionBody.safeParse({ items: [{ ...items[0], medio: 2 }] }).success, false);
});

test("conCorrimiento — cuántos días se corrió el fin contra lo confirmado", () => {
  const fin = finConfirmadoPorOt([{ items: [{ ots: ["1"], fecha: "2026-11-09" }, { ots: ["1", "2"], fecha: "2026-11-10" }] }]);
  assert.equal(fin.get("1"), "2026-11-10");
  const [a, b, c] = conCorrimiento([
    obra("x", ["1"], [{ fecha: "2026-11-13", medio: 0 }]),
    obra("y", ["2"], [{ fecha: "2026-11-09", medio: 0 }]),
    obra("z", ["9"], [{ fecha: "2026-11-09", medio: 0 }]),
  ], fin);
  assert.equal(a.diasCorrido, 3);
  assert.equal(b.diasCorrido, 0); // se adelantó: no avisa
  assert.equal(c.finConfirmado, null);
});

test("misDias — por día y obra: mañana, tarde o todo el día", () => {
  const d = misDias([
    { fecha: "2026-11-10", obra: "b", ots: ["3"], medio: 1, con: [] },
    { fecha: "2026-11-09", obra: "a", ots: ["1"], medio: 0, con: ["Pedro"] },
    { fecha: "2026-11-09", obra: "a", ots: ["1"], medio: 1, con: ["Pedro", "Luis"] },
  ]);
  assert.deepEqual(d.map((x) => [x.fecha, x.parte, x.con.join("+")]), [["2026-11-09", "Todo el día", "Pedro+Luis"], ["2026-11-10", "Tarde", ""]]);
});

test("migración 154 — tablas con RLS por empresa y listada en el esquema", () => {
  const sql = readFileSync("supabase/migrations/154_planes_instalacion.sql", "utf8");
  assert.match(sql, /do \$mig\$/);
  for (const t of ["planes_instalacion", "plan_instalacion_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.ok(MIGRACIONES.some((m) => m.n === 154 && m.tablas.plan_instalacion_items));
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: YO, empresaId: E, legajo: 7, rol })).token;
}
function req(t, { body, query = "" } = {}) {
  return new Request(`http://localhost/api/plan-instalacion${query}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function mock({ sinTabla = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01", modulos: null }] }) },
    { match: (u) => sinTabla && u.includes("planes_instalacion"), respond: () => ({ status: 404, body: { message: "relation \"public.planes_instalacion\" does not exist" } }) },
    { match: (u, o) => o?.method === "POST" || o?.method === "DELETE", respond: (u, o) => {
      escrito.push({ url: u, method: o.method, body: o.body ? JSON.parse(o.body) : null });
      return { status: o.method === "DELETE" ? 204 : 201, body: o.method === "DELETE" ? undefined : [{ id: 9, confirmado_at: "2026-11-02T20:00:00Z" }] };
    } },
    { match: (u) => u.includes("/rest/v1/planes_instalacion?"), respond: () => ({ status: 200, body: [{ id: 9, division_id: null, confirmado_nombre: "Tadeo", confirmado_at: "2026-11-02T20:00:00Z" }] }) },
    { match: (u) => u.includes("/rest/v1/plan_instalacion_items?") && u.includes(`empleado_id=eq.${YO}`), respond: () => ({ status: 200, body: [{ obra: "a", ots: ["1"], fecha: "2099-11-09", medio: 0 }] }) },
    { match: (u) => u.includes("/rest/v1/plan_instalacion_items?"), respond: () => ({ status: 200, body: [{ obra: "a", fecha: "2099-11-09", medio: 0, empleado_id: YO }, { obra: "a", fecha: "2099-11-09", medio: 0, empleado_id: OTRO }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "1", cliente: "Depto", obra: "Torre A" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: OTRO, nombre: "Pedro Gómez", apodo: "Pedro" }] }) },
    { match: () => true, respond: () => ({ status: 200, body: [] }) },
  ]);
  return escrito;
}

test("/api/plan-instalacion — un operario no confirma el plan", async () => {
  mock();
  const r = await api.POST(req(await token("operativo"), { body: { items: [] } }));
  assert.equal(r.status, 403);
});

test("/api/plan-instalacion — gestión confirma: crea el plan, sus días y borra el anterior", async () => {
  const escrito = mock();
  const items = [{ obra: "a", ots: ["1"], fecha: "2026-11-09", medio: 0, empleado_id: YO, orden: 0 }];
  const r = await api.POST(req(await token("gerencial"), { body: { items } }));
  assert.equal(r.status, 200);
  assert.ok(escrito.find((x) => x.url.includes("/plan_instalacion_items")).body.every((i) => i.plan_id === 9 && i.empresa_id === E));
  const borrado = escrito.find((x) => x.method === "DELETE");
  assert.match(borrado.url, /planes_instalacion\?.*division_id=is\.null&id=neq\.9/);
});

test("/api/plan-instalacion — sin la migración 154 avisa", async () => {
  mock({ sinTabla: true });
  const r = await api.POST(req(await token("gerencial"), { body: { items: [] } }));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /migración 154/);
  const g = await (await api.GET(req(await token("gerencial")))).json();
  assert.equal(g.falta_migracion, true);
});

test("/api/plan-instalacion?mio=1 — mis días con la OT y con quién voy", async () => {
  mock();
  const d = await (await api.GET(req(await token("operativo"), { query: "?mio=1" }))).json();
  assert.equal(d.dias.length, 1);
  assert.deepEqual(d.dias[0].con, ["Pedro"]);
  assert.equal(d.dias[0].proyectos[0].cliente, "Depto");
});

test("📅 Mis instalaciones — muestra la obra del día y el compañero", async () => {
  global.fetch = async (u) => new Response(JSON.stringify(String(u).includes("plan-instalacion")
    ? { ok: true, dias: [{ fecha: "2026-11-09", obra: "a", ots: ["1"], medio: 0, proyectos: [{ ot: "1", cliente: "Depto", obra: "Torre A" }], con: ["Pedro"] }] }
    : {}), { status: 200, headers: { "content-type": "application/json" } });
  render(<MisInstalaciones />);
  assert.ok(await screen.findByText("Lunes 9/11"));
  assert.ok(screen.getByText("Mañana"));
  assert.ok(screen.getByText("Con Pedro"));
  assert.ok(screen.getByText("OT 1"));
});
