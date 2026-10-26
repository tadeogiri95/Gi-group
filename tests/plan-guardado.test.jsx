// tests/plan-guardado.test.jsx — Planificación de la producción, parte 41
// (migración 138): gerencia guarda el plan como borrador o lo confirma, y la
// planta lo ve en solo lectura (📅 Plan de la semana).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuerpoPlan, planPorDia, planEsDeMiDivision } from "../app/lib/planGuardado.js";
import { planProduccionBody } from "../app/lib/schemas.ts";
import { stripUnallowedFields } from "../app/lib/validate.ts";
import { normalizarParametros } from "../app/lib/planificacion.js";
import { hoyArg } from "../app/lib/dates.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PlanificacionScreen } = await import("../app/components/PlanificacionScreen.jsx");
const { default: PlanSemana } = await import("../app/components/PlanSemana.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/planificacion/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const DIVISIONES = [{ id: "d-m", clave: "MUE", label: "Muebles" }, { id: "d-h", clave: "HER", label: "Herrería" }];

const CUERPO = {
  tipo: "semana", desde: "2026-10-25", hasta: "2026-10-31", estado: "confirmado", division_id: "d-m",
  horas_necesarias: 12, horas_disponibles: 40, horas_extra: 0, dias_extra: [], pendientes: [],
  items: [{ ot: "7473", etapa: "corte", fecha: "2026-10-26", horas: 6, orden: 0 }],
};

test("prioridad — el arreglo de la parte 38: ahora pasa por /api/data", () => {
  assert.deepEqual(stripUnallowedFields({ prioridad: 3, otra: 1 }, "proyectos", "PATCH"), { prioridad: 3 });
});

test("cuerpoPlan — junta tramos del mismo día, redondea y pasa la validación", () => {
  const plan = {
    segmentos: [
      { id: 1, ot: "7473", etapa: "corte", fecha: "2026-10-26", gente: 2.04 },
      { id: 1, ot: "7473", etapa: "corte", fecha: "2026-10-26", gente: 1 },
      { id: 2, ot: "7500", etapa: "armado", fecha: "2026-10-27", gente: 4 },
    ],
    pendientes: [{ id: 2, ot: "7500", etapa: "armado", gente: 1.26 }],
    diasExtra: [{ fecha: "2026-10-31", horas: 3.33 }],
  };
  const ots = [{ id: 2 }, { id: 1 }];
  const c = cuerpoPlan({ per: { tipo: "semana", desde: "2026-10-25", hasta: "2026-10-31" }, plan, carga: { necesarias: 8.04, disponibles: 40 }, division: DIVISIONES[0], ots, estado: "borrador" });
  assert.deepEqual(c.items, [
    { ot: "7473", etapa: "corte", fecha: "2026-10-26", horas: 3, orden: 1 },
    { ot: "7500", etapa: "armado", fecha: "2026-10-27", horas: 4, orden: 0 },
  ]);
  assert.equal(c.horas_extra, 3.3);
  assert.deepEqual(c.pendientes, [{ ot: "7500", horas: 1.3 }]);
  assert.equal(planProduccionBody.safeParse(c).success, true);
});

test("planPorDia y planEsDeMiDivision", () => {
  const dias = planPorDia([
    { ot: "B", etapa: "armado", fecha: "2026-10-27", horas: 2, orden: 1 },
    { ot: "A", etapa: "canteado", fecha: "2026-10-26", horas: 3, orden: 0 },
    { ot: "A", etapa: "corte", fecha: "2026-10-26", horas: 5, orden: 0 },
  ]);
  assert.deepEqual(dias.map((d) => d.fecha), ["2026-10-26", "2026-10-27"]);
  assert.deepEqual(dias[0].ots[0].etapas.map((e) => e.id), ["corte", "canteado"]);
  assert.equal(planEsDeMiDivision({ division_id: "d-m" }, DIVISIONES, "MUEBLES"), true);
  assert.equal(planEsDeMiDivision({ division_id: "d-m" }, DIVISIONES, "Herrería"), false);
  assert.equal(planEsDeMiDivision({ division_id: null }, DIVISIONES, "Herrería"), true);
  assert.equal(planEsDeMiDivision(null, DIVISIONES, "Muebles"), false);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function req(t, { body, query = "" } = {}) {
  return new Request(`http://localhost/api/planificacion${query}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function mockRuta({ previo = null, planes = [], items = [], sin138 = false } = {}) {
  const escrito = [];
  const leido = [];
  const falta = { status: 404, body: { message: 'relation "public.planes_produccion" does not exist' } };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/planes_produccion") || u.includes("/rest/v1/plan_produccion_items"),
      respond: (u, o) => {
        if (sin138) return falta;
        const metodo = o?.method || "GET";
        if (metodo === "GET") {
          leido.push(u);
          if (u.includes("plan_produccion_items")) return { status: 200, body: items };
          if (u.includes("estado=eq.confirmado")) return { status: 200, body: planes };
          return { status: 200, body: previo ? [previo] : [] };
        }
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ metodo, url: u, body });
        if (metodo === "DELETE") return { status: 204, body: null };
        return { status: 201, body: Array.isArray(body) ? body : [{ id: previo?.id || 9, ...body }] };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/planificacion — solo gerencia guarda o lee un período", async () => {
  mockRuta();
  assert.equal((await api.POST(req(await token("administrativo"), { body: CUERPO }))).status, 403);
  assert.equal((await api.POST(req(await token("operativo"), { body: CUERPO }))).status, 403);
  assert.equal((await api.GET(req(await token("operativo"), { query: "?desde=2026-10-25&hasta=2026-10-31" }))).status, 403);
});

test("/api/planificacion — plan nuevo: lo crea y guarda lo que toca cada día", async () => {
  const { escrito } = mockRuta();
  const res = await api.POST(req(await token("gerencial"), { body: CUERPO }));
  assert.equal(res.status, 200);
  const plan = escrito.find((x) => x.url.includes("planes_produccion"));
  assert.equal(plan.metodo, "POST");
  assert.equal(plan.body.estado, "confirmado");
  assert.equal(plan.body.confirmado_por, EMP);
  assert.equal(plan.body.creado_por, EMP);
  assert.ok(escrito.some((x) => x.metodo === "DELETE" && x.url.includes("plan_id=eq.9")));
  const items = escrito.find((x) => x.metodo === "POST" && x.url.includes("plan_produccion_items"));
  assert.deepEqual(items.body, [{ ...CUERPO.items[0], plan_id: 9, empresa_id: E }]);
});

test("/api/planificacion — el mismo período se reemplaza; volver a borrador saca la confirmación", async () => {
  const { escrito } = mockRuta({ previo: { id: 4, estado: "confirmado" } });
  const res = await api.POST(req(await token("gerencial"), { body: { ...CUERPO, estado: "borrador" } }));
  assert.equal(res.status, 200);
  const plan = escrito.find((x) => x.url.includes("planes_produccion"));
  assert.equal(plan.metodo, "PATCH");
  assert.match(plan.url, /id=eq\.4/);
  assert.equal(plan.body.confirmado_por, null);
  assert.equal("creado_por" in plan.body, false);
});

test("/api/planificacion — rechaza días fuera del período y avisa si falta la migración", async () => {
  mockRuta();
  const fuera = await api.POST(req(await token("gerencial"), { body: { ...CUERPO, items: [{ ...CUERPO.items[0], fecha: "2026-11-02" }] } }));
  assert.equal(fuera.status, 400);
  mockRuta({ sin138: true });
  assert.equal((await api.POST(req(await token("gerencial"), { body: CUERPO }))).status, 409);
  const get = await (await api.GET(req(await token("operativo"), { query: "?fecha=2026-10-26" }))).json();
  assert.equal(get.falta_migracion, true);
  assert.equal(get.plan, null);
});

test("/api/planificacion — la planta ve el confirmado del día (la semana le gana al mes)", async () => {
  const { leido } = mockRuta({
    planes: [
      { id: 1, tipo: "mes", desde: "2026-10-01", hasta: "2026-10-31", estado: "confirmado" },
      { id: 2, tipo: "semana", desde: "2026-10-25", hasta: "2026-10-31", estado: "confirmado" },
    ],
    items: CUERPO.items,
  });
  const d = await (await api.GET(req(await token("operativo"), { query: "?fecha=2026-10-26" }))).json();
  assert.equal(d.plan.id, 2);
  assert.deepEqual(d.plan.items, CUERPO.items);
  assert.ok(leido.some((u) => u.includes("plan_id=eq.2")));
});

// ─── Pantallas ───

const P = normalizarParametros({
  min_placa: 10, min_metro_canto: 1, min_mecanizado_placa: 15, min_armado_gabinete: 60, eficiencia: 80,
  pct_mecanizado: 50, gabinetes_por_placa: 0.5, etapas: { corte: 1, canteado: 2, mecanizado: 3, armado: 4 },
});

function mockCarga({ guardado = null } = {}) {
  const enviados = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("/api/planificacion")) {
      if (opts?.method === "POST") {
        const b = JSON.parse(opts.body);
        enviados.push(b);
        return new Response(JSON.stringify({ ok: true, plan: { id: 3, ...b, confirmado_at: b.estado === "confirmado" ? "2026-10-26T15:00:00Z" : null, confirmado_por: b.estado === "confirmado" ? "e9" : null } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, plan: guardado }), { status: 200 });
    }
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const path = body.path || "";
    const lista = (data) => new Response(JSON.stringify({ data: path.includes("offset=0") || !path.includes("offset=") ? data : [] }), { status: 200 });
    if (path.startsWith("proyectos")) return lista([{ id: 1, ot: "M-7473", cliente: "Cliente", division: "Muebles", estado: "activo", fecha_objetivo: "2020-01-04", placas: 10, fondos: 2, metros_canto: 120, total_modulos: 4 }]);
    if (path.startsWith("empleados")) return lista([
      { id: "e1", rol: "operativo", division: "Muebles", diagrama: { lun: { in: "08:00", out: "16:00" } } },
      { id: "e9", nombre: "Tadeo", rol: "gerencial" },
    ]);
    if (path.startsWith("config_sistema") && path.includes("clave=eq.planificacion")) return lista([{ valor: { ...P } }]);
    return lista([]);
  };
  return enviados;
}

const pantalla = () => render(
  <AuthContext.Provider value={{ divisiones: DIVISIONES, etapas: [], usuario: { rol: "gerencial" } }}>
    <PlanificacionScreen empresaId="emp-1" />
  </AuthContext.Provider>
);

test("📊 Carga — guardar borrador y confirmar el plan del período", async () => {
  const enviados = mockCarga();
  pantalla();
  await waitFor(() => assert.equal(screen.getByLabelText("Planificar OT M-7473").checked, true));
  fireEvent.click(screen.getByText("Ordenar automáticamente"));
  fireEvent.click(await screen.findByText("Guardar borrador"));
  assert.ok(await screen.findByText(/Hay un borrador guardado/));
  assert.equal(enviados[0].estado, "borrador");
  assert.equal(enviados[0].division_id, "d-m");
  assert.ok(enviados[0].items.length > 0);
  assert.ok(enviados[0].items.every((i) => i.ot === "M-7473"));
  fireEvent.click(screen.getByText("Confirmar plan"));
  assert.ok(await screen.findByText(/Plan confirmado .* por Tadeo/));
  assert.equal(enviados[1].estado, "confirmado");
  assert.ok(screen.getByText("Confirmar de nuevo"));
});

test("📊 Carga — sin la migración 138 avisa y no ofrece guardar", async () => {
  mockCarga();
  global.fetch = ((orig) => async (url, opts) => (String(url).startsWith("/api/planificacion")
    ? new Response(JSON.stringify({ ok: true, plan: null, falta_migracion: true }), { status: 200 })
    : orig(url, opts)))(global.fetch);
  pantalla();
  assert.ok(await screen.findByText(/falta correr la migración 138/));
  fireEvent.click(screen.getByText("Ordenar automáticamente"));
  assert.equal(screen.queryByText("Guardar borrador"), null);
});

test("📅 Plan de la semana — la planta ve qué OT y etapa toca hoy; otra división no lo ve", async () => {
  const hoy = hoyArg();
  const plan = { id: 2, tipo: "semana", desde: hoy, hasta: hoy, division_id: "d-m", dias_extra: [], items: [
    { ot: "7473", etapa: "corte", fecha: hoy, horas: 6, orden: 0 },
    { ot: "7473", etapa: "canteado", fecha: hoy, horas: 2, orden: 0 },
  ] };
  global.fetch = async () => new Response(JSON.stringify({ ok: true, plan }), { status: 200 });
  render(<PlanSemana divisiones={DIVISIONES} divisionUsuario="Muebles" />);
  const caja = await screen.findByRole("region", { name: "Plan de la semana" });
  assert.match(caja.textContent, /Hoy · /);
  assert.match(caja.textContent, /7473/);
  assert.match(caja.textContent, /Corte 6 h/);
  cleanup();
  render(<PlanSemana divisiones={DIVISIONES} divisionUsuario="Herrería" />);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(screen.queryByRole("region", { name: "Plan de la semana" }), null);
});
