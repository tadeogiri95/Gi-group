// tests/paradas-cantidades.test.jsx — Órdenes de Producción, parte 4 (ítem 39):
// causas de parada propias de cada empresa, parada con la OT en la que se
// estaba, unidad por etapa y cantidad hecha en cada tarea.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { CAUSAS_DEFECTO, CAUSAS_FABRICA, normalizarCausas, causasDe, nombreCausa } from "../app/lib/causas.js";
import { actividadBody, configPatchBody } from "../app/lib/schemas.ts";
import { validarPatch } from "../app/lib/dataPolicy.js";
import { resumirOp } from "../app/lib/detalleOp.js";
import { armarResumen } from "../app/lib/resumenSemanal.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: CausasEditor } = await import("../app/components/CausasEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const actividadApi = await import("../app/api/actividad/route.js");
const configApi = await import("../app/api/config-empresa/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ETAPA_ID = "44444444-4444-4444-4444-444444444444";

// ─── Reglas ───

test("causas — sin lista propia se usan las de siempre; la lista se limpia", () => {
  assert.deepEqual(causasDe(null), CAUSAS_DEFECTO);
  assert.deepEqual(causasDe([]), CAUSAS_DEFECTO);
  assert.deepEqual(
    normalizarCausas([{ cod: "sm", nombre: " Sin material " }, { cod: "SM", nombre: "Repetida" }, { cod: "MUY LARGO", nombre: "x" }, { cod: "RO", nombre: "" }]).map((c) => [c.cod, c.nombre]),
    [["SM", "Sin material"]],
  );
  assert.equal(nombreCausa(CAUSAS_FABRICA, "SP"), "Sin pedido o sin trabajo programado");
  assert.equal(nombreCausa(CAUSAS_FABRICA, "M"), "Falta material", "las paradas viejas siguen con su nombre");
  assert.equal(nombreCausa(CAUSAS_FABRICA, "ZZ"), "ZZ");
});

test("validación — etapas de más de 8 y códigos de parada de hasta 4 caracteres", () => {
  assert.ok(actividadBody.safeParse({ accion: "iniciar", etapa: 12, codigo_proyecto: "7495" }).success, "etapa 12 se puede usar");
  assert.ok(actividadBody.safeParse({ accion: "iniciar", etapa: 0, causa: "SP", codigo_proyecto: "7495" }).success, "parada con código y OT");
  assert.ok(!actividadBody.safeParse({ accion: "iniciar", etapa: 0, causa: "sin pedido" }).success);
  assert.ok(configPatchBody.safeParse({ action: "update_causas", causas: CAUSAS_FABRICA }).success);
  assert.ok(!configPatchBody.safeParse({ action: "update_causas", causas: [{ cod: "TOO LONG", nombre: "x" }] }).success);
  assert.equal(validarPatch("registro_actividades", { cantidad: 12.5 }), null);
  assert.equal(validarPatch("registro_actividades", { cantidad: null }), null);
  assert.equal(validarPatch("registro_actividades", { cantidad: -1 })?.status, 400);
  assert.equal(validarPatch("registro_actividades", { cantidad: "12" })?.status, 400);
});

test("migración 099 — causa de hasta 4 caracteres, etapas hasta 999, parada con OT, cantidad y unidad", () => {
  const sql = readFileSync(new URL("../supabase/migrations/099_paradas_cantidades.sql", import.meta.url), "utf8");
  assert.match(sql, /alter column causa type text/);
  assert.match(sql, /causa ~ '\^\[A-Z0-9\]\{1,4\}\$'/);
  assert.match(sql, /etapa >= 0 and etapa <= 999/);
  assert.match(sql, /etapa = 0 or codigo_proyecto is not null/);
  assert.match(sql, /add column if not exists cantidad numeric/);
  assert.match(sql, /alter table public\.etapas add column if not exists unidad text/);
  // La vista que usa causa se rehace igual, con security_invoker (096)
  assert.match(sql, /drop view if exists public\.v_resumen_diario/);
  assert.match(sql, /with \(security_invoker = true\)/);
  assert.match(sql, /grant select on public\.v_resumen_diario to authenticated/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test("resumirOp — cantidad por etapa, minutos por unidad y paradas de la OT", () => {
  const etapas = [{ codigo: 1, nombre: "Corte", unidad: "placas" }, { codigo: 2, nombre: "Armado", unidad: "módulos" }];
  const r = resumirOp([
    { legajo: 1, etapa: 1, hora_fin: "x", duracion_min: 60, cantidad: 10 },
    { legajo: 1, etapa: 1, hora_fin: "x", duracion_min: 30, cantidad: 5 },
    { legajo: 1, etapa: 1, hora_fin: "x", duracion_min: 20, cantidad: null }, // sin anotar: no cuenta para min por placa
    { legajo: 2, etapa: 2, hora_fin: "x", duracion_min: 90 },
    { legajo: 1, etapa: 0, causa: "SM", hora_fin: "x", duracion_min: 15 },
    { legajo: 2, etapa: 0, causa: "SM", hora_fin: "x", duracion_min: 10 },
    { legajo: 2, etapa: 0, causa: "RO", hora_fin: "x", duracion_min: 40 },
  ], { etapas, causas: CAUSAS_FABRICA });
  const corte = r.etapas.find((e) => e.codigo === 1);
  assert.equal(corte.cantidad, 15);
  assert.equal(corte.unidad, "placas");
  assert.equal(corte.minPorUnidad, 6);
  assert.equal(r.etapas.find((e) => e.codigo === 2).minPorUnidad, null);
  assert.equal(r.totalMin, 200, "las paradas no suman a las horas trabajadas");
  assert.deepEqual(r.paradas.map((p) => [p.causa, p.nombre, p.veces, p.min]), [["RO", "Rotura o falla", 1, 40], ["SM", "Sin material", 2, 25]]);
  assert.equal(r.paradaMin, 65);
});

test("resumen semanal — usa los nombres de las causas de la empresa", () => {
  const r = armarResumen({
    desde: "2026-10-05", hasta: "2026-10-11",
    actividades: [{ legajo: "1", etapa: 0, causa: "SM", duracion_min: 60 }, { legajo: "1", etapa: 0, causa: "M", duracion_min: 30 }],
    causas: CAUSAS_FABRICA,
  });
  assert.deepEqual(r.tiempoMuerto.causas, [{ causa: "Sin material", horas: 1 }, { causa: "Falta material", horas: 0.5 }]);
});

// ─── Operario ───

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸", color: "#DC2626" },
  { codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00", unidad: "placas" },
  { codigo: 9, nombre: "Control de calidad", icon: "✅", color: "#0F0" },
];

function operario({ tareaActiva = null, historial = [], iniciarTarea = async () => {} } = {}) {
  render(
    <ActividadScreen
      tareaActiva={tareaActiva} historial={historial} etapas={ETAPAS} causas={CAUSAS_FABRICA} proyectos={[{ ot: "7495", cliente: "Siciliano" }]}
      loading={false} elapsed={0} usuario={{ id: "emp-paradas" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={iniciarTarea} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
    />
  );
}

test("Estoy parado — muestra las causas de la empresa y la parada queda en la OT", async () => {
  const pedidos = [];
  operario({
    tareaActiva: { id: 50, etapa: 1, codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" },
    iniciarTarea: async (t) => { pedidos.push(t); },
  });
  fireEvent.click(screen.getByText(/Estoy parado/));
  assert.ok(screen.getByText("Sin material"));
  assert.equal(screen.queryByText("Falta herramienta"), null, "las de siempre no aparecen si la empresa tiene las suyas");
  fireEvent.click(screen.getByText("Sin material"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { etapa: 0, codigo_proyecto: "7495", tipo: "N", causa: "SM" });
});

test("cantidad — la tarea en curso de una etapa con unidad deja anotar lo hecho", async () => {
  const enviados = [];
  global.fetch = async (url, opts) => {
    enviados.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ data: [{ id: 50, cantidad: 12 }] }), { status: 200 });
  };
  operario({ tareaActiva: { id: 50, etapa: 1, codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" } });
  const input = screen.getByLabelText("Cantidad hecha (placas)");
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { method: "PATCH", path: "registro_actividades?id=eq.50", body: { cantidad: 12 } });
  await waitFor(() => assert.equal(screen.queryByText("Guardar"), null));
});

test("cantidad — una etapa sin unidad no pide cantidad", () => {
  operario({ tareaActiva: { id: 51, etapa: 9, codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" } });
  assert.equal(screen.queryByLabelText(/Cantidad hecha/), null);
});

// ─── Dueño: causas de parada ───

test("pantalla de paradas — cargar los códigos de fábrica y guardar", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    pedidos.push(body);
    return new Response(JSON.stringify({ causas_parada: body.causas }), { status: 200 });
  };
  const guardadas = [];
  render(<CausasEditor causas={[]} onGuardadas={(l) => guardadas.push(l)} />);
  assert.ok(screen.getByText(/Causas de siempre/));
  fireEvent.click(screen.getByText(/Usar los códigos de fábrica/));
  fireEvent.change(screen.getByLabelText("Código de la causa"), { target: { value: "lu" } });
  fireEvent.change(screen.getByLabelText("Nombre de la causa"), { target: { value: "Falta de luz" } });
  fireEvent.click(screen.getByText("Agregar"));
  fireEvent.click(screen.getByText("Guardar causas"));
  await waitFor(() => assert.equal(guardadas.length, 1));
  assert.equal(pedidos[0].action, "update_causas");
  assert.deepEqual(pedidos[0].causas.map((c) => c.cod), ["SP", "SM", "MA", "RO", "CA", "OT", "LU"]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

test("/api/actividad — una parada lleva la OT y el código de la empresa", async () => {
  const rpc = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/rpc/registrar_actividad"), respond: (u, o) => { rpc.push(JSON.parse(o.body)); return { status: 200, body: { ok: true, cerradas: 1, tarea: { id: 9 } } }; } },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: [{ division: "muebles", legajo: 7 }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/realtime/"), respond: () => ({ status: 200, body: {} }) },
  ]);
  const res = await actividadApi.POST(new Request("http://localhost/api/actividad", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("operativo")}` },
    body: JSON.stringify({ accion: "iniciar", etapa: 0, causa: "SM", codigo_proyecto: "7495" }),
  }));
  assert.equal(res.status, 200);
  assert.equal(rpc[0].p_nueva.causa, "SM");
  assert.equal(rpc[0].p_nueva.codigo_proyecto, "7495");
});

function configReq(method, body, t) {
  return new Request("http://localhost/api/config-empresa", {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("config-empresa — GET devuelve las causas de la empresa", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/config_sistema") && u.includes("clave=eq.causas_parada"), respond: () => ({ status: 200, body: [{ valor: { lista: CAUSAS_FABRICA } }] }) },
    { match: (u) => /\/rest\/v1\/(divisiones|etapas|plantas)\?/.test(u), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await configApi.GET(configReq("GET", null, await token("operativo")));
  const data = await res.json();
  assert.deepEqual(data.causas_parada.map((c) => c.cod), ["SP", "SM", "MA", "RO", "CA", "OT"]);
});

test("config-empresa — update_causas crea la lista la primera vez y la actualiza después", async () => {
  for (const existe of [false, true]) {
    const escrito = [];
    global.fetch = createFetchMock([
      ...authPassHandlers(),
      { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: existe ? [{ clave: "causas_parada" }] : [] }) },
      { match: (u, o) => u.includes("/rest/v1/config_sistema") && ["POST", "PATCH"].includes(o?.method), respond: (u, o) => { escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) }); return { status: 200, body: [{}] }; } },
    ]);
    const res = await configApi.PATCH(configReq("PATCH", { action: "update_causas", causas: [{ cod: "sm", nombre: "Sin material" }] }, await token("gerencial")));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).causas_parada, [{ cod: "SM", nombre: "Sin material", icon: "⏸" }]);
    assert.equal(escrito.length, 1);
    assert.equal(escrito[0].metodo, existe ? "PATCH" : "POST");
    assert.deepEqual(escrito[0].body.valor, { lista: [{ cod: "SM", nombre: "Sin material", icon: "⏸" }] });
    if (!existe) assert.equal(escrito[0].body.empresa_id, E);
    else assert.match(escrito[0].url, new RegExp(`empresa_id=eq\\.${E}`));
  }
});

test("config-empresa — update_causas rechaza códigos repetidos y un operario no puede", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  let res = await configApi.PATCH(configReq("PATCH", { action: "update_causas", causas: [{ cod: "SM", nombre: "a" }, { cod: "sm", nombre: "b" }] }, await token("gerencial")));
  assert.equal(res.status, 400);
  res = await configApi.PATCH(configReq("PATCH", { action: "update_causas", causas: [] }, await token("operativo")));
  assert.equal(res.status, 403);
});

test("config-empresa — la etapa guarda su unidad; vacía queda sin unidad", async () => {
  const enviados = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/etapas") && u.includes("select=empresa_id"), respond: () => ({ status: 200, body: [{ empresa_id: E }] }) },
    { match: (u, o) => u.includes("/rest/v1/etapas") && o?.method === "PATCH", respond: (u, o) => { enviados.push(JSON.parse(o.body)); return { status: 200, body: [{ id: ETAPA_ID }] }; } },
  ]);
  for (const unidad of ["placas", ""]) {
    const res = await configApi.PATCH(configReq("PATCH", { action: "update_etapa", id: ETAPA_ID, unidad }, await token("gerencial")));
    assert.equal(res.status, 200);
  }
  assert.deepEqual(enviados, [{ unidad: "placas" }, { unidad: null }]);
});
