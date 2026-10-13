// tests/avance-tablero.test.jsx — Órdenes de Producción, parte 5 (ítem 39):
// avance de cada etapa por OT con la firma del responsable, OT liberada con
// checklist y puntos críticos, y el tablero de OT tipo pizarra.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { estadoEtapa, semaforoEntrega, filasTablero, normalizarChecklist, CHECKLIST_FABRICA } from "../app/lib/avance.js";
import { avanceBody, configPatchBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: TableroOt } = await import("../app/components/TableroOt.jsx");
const { default: ChecklistEditor } = await import("../app/components/ChecklistEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const avanceApi = await import("../app/api/avance/route.js");
const configApi = await import("../app/api/config-empresa/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const ETAPA_ID = "44444444-4444-4444-4444-444444444444";

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸" },
  { codigo: 1, nombre: "Corte", icon: "✂️", orden: 1 },
  { codigo: 2, nombre: "Canteado", icon: "📏", orden: 2 },
  { codigo: 3, nombre: "Armado", icon: "🔧", orden: 3, condicion_cierre: "Módulos completos según planilla" },
];
const DIVISIONES = [{ id: "muebles", label: "Muebles", ruta_etapas: [1, 2, 3] }, { id: "otra", label: "Otra" }];

// ─── Reglas ───

test("estadoEtapa — sin fila es pendiente o en curso según las horas", () => {
  assert.equal(estadoEtapa(null, false), "pendiente");
  assert.equal(estadoEtapa(null, true), "en_curso");
  assert.equal(estadoEtapa({ estado: "terminada" }, true), "terminada");
  assert.equal(estadoEtapa({ estado: "aprobada" }, false), "aprobada");
  assert.equal(estadoEtapa({ estado: "no_aplica" }, true), "no_aplica");
});

test("semaforoEntrega — atrasada en rojo, 7 días o menos en amarillo", () => {
  assert.equal(semaforoEntrega("2026-10-12", "2026-10-13"), "rojo");
  assert.equal(semaforoEntrega("2026-10-13", "2026-10-13"), "amarillo");
  assert.equal(semaforoEntrega("2026-10-20", "2026-10-13"), "amarillo");
  assert.equal(semaforoEntrega("2026-10-21", "2026-10-13"), "verde");
  assert.equal(semaforoEntrega(null, "2026-10-13"), null);
});

test("normalizarChecklist — sin vacíos ni repetidos, hasta 20", () => {
  assert.deepEqual(normalizarChecklist([" Plano firmado ", "", "Plano firmado", null, "Material"]), ["Plano firmado", "Material"]);
  assert.equal(normalizarChecklist(Array.from({ length: 30 }, (_, i) => `Item ${i}`)).length, 20);
  assert.deepEqual(normalizarChecklist("no es lista"), []);
});

test("filasTablero — columnas por ruta, estados, por firmar y orden por entrega", () => {
  const filas = filasTablero([
    { id: 1, ot: "7500", division: "muebles", fecha_entrega: "2026-11-30" },
    { id: 2, ot: "7495", division: "MUEBLES", fecha_entrega: "2026-10-10", liberada_at: "2026-10-01T10:00:00Z" },
    { id: 3, ot: "7510", division: "otra" },
  ], {
    etapas: ETAPAS, divisiones: DIVISIONES, hoy: "2026-10-13",
    avance: [{ ot: "7495", etapa: 1, estado: "aprobada" }, { ot: "7495", etapa: 2, estado: "terminada" }, { ot: "7510", etapa: 3, estado: "no_aplica" }],
    horas: new Set(["7495|3", "7510|2"]),
  });
  assert.deepEqual(filas.map((f) => f.proyecto.ot), ["7495", "7500", "7510"], "sin fecha va al final");
  const [a, b, c] = filas;
  assert.deepEqual(a.celdas.map((x) => x.estado), ["aprobada", "terminada", "en_curso"]);
  assert.equal(a.porFirmar, 1);
  assert.equal(a.cerradas, 1);
  assert.equal(a.liberada, true);
  assert.equal(a.semaforo, "rojo");
  assert.deepEqual(b.celdas.map((x) => x.estado), ["pendiente", "pendiente", "pendiente"]);
  assert.equal(b.liberada, false);
  // Sin ruta: las etapas con horas o con avance, en el orden de las etapas
  assert.deepEqual(c.celdas.map((x) => [x.codigo, x.estado]), [[2, "en_curso"], [3, "no_aplica"]]);
});

test("validación — acciones de avance y checklist", () => {
  assert.ok(avanceBody.safeParse({ accion: "terminar", ot: 7495, etapa: 2 }).success, "la OT puede venir como número");
  assert.equal(avanceBody.parse({ accion: "terminar", ot: 7495, etapa: 2 }).ot, "7495");
  assert.ok(!avanceBody.safeParse({ accion: "aprobar", ot: "7495" }).success, "firmar una etapa pide la etapa");
  assert.ok(avanceBody.safeParse({ accion: "liberar", ot: "7495", liberacion: ["Plano"] }).success);
  assert.ok(!avanceBody.safeParse({ accion: "borrar_todo", ot: "7495" }).success);
  assert.ok(configPatchBody.safeParse({ action: "update_checklist", items: CHECKLIST_FABRICA }).success);
  assert.ok(!configPatchBody.safeParse({ action: "update_checklist", items: Array.from({ length: 21 }, (_, i) => `x${i}`) }).success);
});

test("migración 100 — tabla de avance con RLS por empresa, liberación, puntos críticos y condición", () => {
  const sql = readFileSync(new URL("../supabase/migrations/100_avance_etapas.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.avance_etapas/);
  assert.match(sql, /check \(estado in \('terminada', 'aprobada', 'no_aplica'\)\)/);
  assert.match(sql, /unique \(empresa_id, ot, etapa\)/);
  assert.match(sql, /alter table public\.avance_etapas enable row level security/);
  assert.match(sql, /using \(empresa_id = \(current_setting\('request\.jwt\.claims', true\)::json->>'eid'\)::uuid\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.avance_etapas to authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.avance_etapas_id_seq to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  for (const col of ["liberada_at", "liberada_por", "liberacion", "puntos_criticos"]) {
    assert.match(sql, new RegExp(`alter table public\\.proyectos add column if not exists ${col}`));
  }
  assert.match(sql, /alter table public\.etapas add column if not exists condicion_cierre text/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Operario ───

function operario(tareaActiva, proyectos = [{ ot: "7495", cliente: "Siciliano", puntos_criticos: "Cortes a 45°" }]) {
  render(
    <ActividadScreen
      tareaActiva={tareaActiva} historial={[]} etapas={ETAPAS} proyectos={proyectos}
      loading={false} elapsed={0} usuario={{ id: "emp-avance" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async () => {}} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
    />
  );
}

test("Terminé esta etapa — avisa que espera la firma y muestra los puntos críticos", async () => {
  const enviados = [];
  global.fetch = async (url, opts) => {
    enviados.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true, avance: { estado: "terminada" } }), { status: 200 });
  };
  operario({ id: 60, etapa: 2, codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" });
  assert.ok(screen.getByText(/Cortes a 45°/), "los puntos críticos se ven mientras trabaja");
  fireEvent.click(screen.getByText(/Terminé esta etapa/));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.match(enviados[0].url, /\/api\/avance$/);
  assert.deepEqual(enviados[0].body, { accion: "terminar", ot: "7495", etapa: 2 });
  await waitFor(() => assert.ok(screen.getByText(/esperando la firma del responsable/)));
});

test("Terminé esta etapa — no aparece estando parado", () => {
  operario({ id: 61, etapa: 0, causa: "SM", codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" });
  assert.equal(screen.queryByText(/Terminé esta etapa/), null);
});

// ─── Tablero ───

function mockTablero({ avance = [], horas = [], respuestaAvance }) {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts?.body ? JSON.parse(opts.body) : null;
    if (u.includes("/api/avance")) {
      pedidos.push(body);
      return new Response(JSON.stringify(respuestaAvance(body)), { status: 200 });
    }
    const path = body?.path || "";
    if (path.startsWith("avance_etapas")) return new Response(JSON.stringify({ data: avance }), { status: 200 });
    if (path.startsWith("registro_actividades")) return new Response(JSON.stringify({ data: horas }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

test("tablero — el responsable firma una etapa terminada", async () => {
  const pedidos = mockTablero({
    avance: [{ ot: "7495", etapa: 2, estado: "terminada", terminada_at: "2026-10-12T15:00:00Z" }],
    respuestaAvance: () => ({ ok: true, avance: { estado: "aprobada", aprobada_at: "2026-10-13T10:00:00Z" } }),
  });
  render(<TableroOt proyectos={[{ id: 1, ot: "7495", cliente: "Siciliano", division: "muebles", fecha_entrega: "2026-10-30" }]}
    empresaId={E} etapas={ETAPAS} divisiones={DIVISIONES} checklist={[]} />);
  await waitFor(() => assert.ok(screen.getByText(/1 etapa por firmar/)));
  fireEvent.click(screen.getByLabelText("Canteado de la OT 7495: Terminada, falta la firma"));
  fireEvent.click(screen.getByText(/Firmar el cierre/));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { accion: "aprobar", ot: "7495", etapa: 2 });
  await waitFor(() => assert.ok(screen.getByLabelText("Canteado de la OT 7495: Firmada")));
});

test("tablero — la condición de cierre de la etapa se ve antes de firmar", async () => {
  mockTablero({ respuestaAvance: () => ({ ok: true }) });
  render(<TableroOt proyectos={[{ id: 1, ot: "7495", division: "muebles" }]} empresaId={E} etapas={ETAPAS} divisiones={DIVISIONES} checklist={[]} />);
  await waitFor(() => screen.getByLabelText("Armado de la OT 7495: Pendiente"));
  fireEvent.click(screen.getByLabelText("Armado de la OT 7495: Pendiente"));
  assert.ok(screen.getByText(/Módulos completos según planilla/));
});

test("tablero — liberar pide todo el checklist tildado y guarda los puntos críticos", async () => {
  const pedidos = mockTablero({ respuestaAvance: (b) => ({ ok: true, proyecto: { liberada_at: "2026-10-13T10:00:00Z", puntos_criticos: b.puntos_criticos } }) });
  const actualizados = [];
  render(<TableroOt proyectos={[{ id: 1, ot: "7495", division: "muebles" }]} empresaId={E} etapas={ETAPAS} divisiones={DIVISIONES}
    checklist={["Plano firmado", "Material en depósito"]} onProyectoActualizado={(p) => actualizados.push(p)} />);
  await waitFor(() => screen.getByLabelText("Liberación de la OT 7495: sin liberar"));
  fireEvent.click(screen.getByLabelText("Liberación de la OT 7495: sin liberar"));
  const boton = screen.getByText(/Tildá todo el checklist/);
  assert.equal(boton.disabled, true);
  fireEvent.click(screen.getByLabelText("Plano firmado"));
  fireEvent.click(screen.getByLabelText("Material en depósito"));
  fireEvent.change(screen.getByLabelText("Puntos críticos de la OT"), { target: { value: "Piezas VER PLANO" } });
  fireEvent.click(screen.getByText(/Liberar la OT a producción/));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { accion: "liberar", ot: "7495", liberacion: ["Plano firmado", "Material en depósito"], puntos_criticos: "Piezas VER PLANO" });
  await waitFor(() => assert.equal(actualizados.length, 1));
  assert.equal(actualizados[0].liberada_at, "2026-10-13T10:00:00Z");
});

// ─── Dueño: checklist ───

test("pantalla de liberación — cargar el checklist de fábrica y guardar", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    pedidos.push(body);
    return new Response(JSON.stringify({ checklist_liberacion: body.items }), { status: 200 });
  };
  const guardados = [];
  render(<ChecklistEditor items={[]} onGuardado={(l) => guardados.push(l)} />);
  fireEvent.click(screen.getByText(/Usar el checklist de fábrica/));
  fireEvent.click(screen.getByText(/Guardar checklist/));
  await waitFor(() => assert.equal(guardados.length, 1));
  assert.equal(pedidos[0].action, "update_checklist");
  assert.deepEqual(pedidos[0].items, CHECKLIST_FABRICA);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function avanceReq(body, t) {
  return new Request("http://localhost/api/avance", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mockAvance({ existente = null, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?") && u.includes("select=id,ot"), respond: () => ({ status: 200, body: [{ id: 1, ot: "7495" }] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && o?.method === "PATCH", respond: (u, o) => { escrito.push({ metodo: "PATCH", tabla: "proyectos", body: JSON.parse(o.body) }); return { status: 200, body: [{ id: 1, ot: "7495", ...JSON.parse(o.body) }] }; } },
    { match: (u, o) => u.includes("/rest/v1/avance_etapas") && (!o?.method || o.method === "GET"), respond: () => falla ? { status: 400, body: { message: falla } } : { status: 200, body: existente ? [existente] : [] } },
    { match: (u, o) => u.includes("/rest/v1/avance_etapas") && ["POST", "PATCH", "DELETE"].includes(o?.method), respond: (u, o) => { escrito.push({ metodo: o.method, tabla: "avance_etapas", url: u, body: o.body ? JSON.parse(o.body) : null }); return { status: 200, body: o.body ? [JSON.parse(o.body)] : [] }; } },
  ]);
  return escrito;
}

test("/api/avance — el operario marca terminada; la primera vez crea la fila", async () => {
  const escrito = mockAvance();
  const res = await avanceApi.POST(avanceReq({ accion: "terminar", ot: "7495", etapa: 2 }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito.length, 1);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.estado, "terminada");
  assert.equal(escrito[0].body.terminada_por, EMP);
});

test("/api/avance — terminar no deshace una etapa ya firmada", async () => {
  const escrito = mockAvance({ existente: { id: 5, estado: "aprobada" } });
  const res = await avanceApi.POST(avanceReq({ accion: "terminar", ot: "7495", etapa: 2 }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).avance.estado, "aprobada");
  assert.equal(escrito.length, 0);
});

test("/api/avance — firmar, liberar y reabrir son solo del responsable", async () => {
  mockAvance();
  for (const body of [{ accion: "aprobar", ot: "7495", etapa: 2 }, { accion: "liberar", ot: "7495" }, { accion: "reabrir", ot: "7495", etapa: 2 }]) {
    const res = await avanceApi.POST(avanceReq(body, await token("operativo")));
    assert.equal(res.status, 403, body.accion);
  }
});

test("/api/avance — el responsable firma, reabre y libera", async () => {
  let escrito = mockAvance({ existente: { id: 5, estado: "terminada" } });
  let res = await avanceApi.POST(avanceReq({ accion: "aprobar", ot: "7495", etapa: 2 }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.equal(escrito[0].body.estado, "aprobada");
  assert.equal(escrito[0].body.aprobada_por, EMP);

  escrito = mockAvance({ existente: { id: 5, estado: "aprobada" } });
  res = await avanceApi.POST(avanceReq({ accion: "reabrir", ot: "7495", etapa: 2 }, await token("administrativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");

  escrito = mockAvance();
  res = await avanceApi.POST(avanceReq({ accion: "liberar", ot: "7495", liberacion: ["Plano"], puntos_criticos: "Cortes a 45°" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].tabla, "proyectos");
  assert.deepEqual(escrito[0].body.liberacion, { items: ["Plano"] });
  assert.equal(escrito[0].body.liberada_por, EMP);
  assert.equal(escrito[0].body.puntos_criticos, "Cortes a 45°");
});

test("/api/avance — sin la migración 100 avisa qué falta", async () => {
  mockAvance({ falla: 'relation "public.avance_etapas" does not exist' });
  const res = await avanceApi.POST(avanceReq({ accion: "terminar", ot: "7495", etapa: 2 }, await token("operativo")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 100/);
});

function configReq(method, body, t) {
  return new Request("http://localhost/api/config-empresa", {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("config-empresa — guarda el checklist y la condición de cierre de una etapa", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "POST", respond: (u, o) => { escrito.push(JSON.parse(o.body)); return { status: 200, body: [{}] }; } },
    { match: (u) => u.includes("/rest/v1/etapas") && u.includes("select=empresa_id"), respond: () => ({ status: 200, body: [{ empresa_id: E }] }) },
    { match: (u, o) => u.includes("/rest/v1/etapas") && o?.method === "PATCH", respond: (u, o) => { escrito.push(JSON.parse(o.body)); return { status: 200, body: [{ id: ETAPA_ID }] }; } },
  ]);
  let res = await configApi.PATCH(configReq("PATCH", { action: "update_checklist", items: [" Plano firmado ", "Plano firmado", "Material"] }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).checklist_liberacion, ["Plano firmado", "Material"]);
  assert.equal(escrito[0].clave, "checklist_liberacion");
  assert.deepEqual(escrito[0].valor, { lista: ["Plano firmado", "Material"] });

  res = await configApi.PATCH(configReq("PATCH", { action: "update_etapa", id: ETAPA_ID, condicion_cierre: "Módulos completos" }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[1], { condicion_cierre: "Módulos completos" });

  res = await configApi.PATCH(configReq("PATCH", { action: "update_checklist", items: [] }, await token("operativo")));
  assert.equal(res.status, 403);
});
