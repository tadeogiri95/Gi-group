// tests/modulos-calidad.test.jsx — Órdenes de Producción, parte 6 (ítem 39):
// total de módulos por OT ("3 de 12") y registro de no conformidades con
// código de defecto, etapa de origen y decisión del encargado.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { parseCsvProyectos } from "../app/lib/csvProyectos.js";
import {
  DEFECTOS_DEFECTO, DEFECTOS_FABRICA, defectosDe, defectosFabricaPara, normalizarDefectos, nombreDefecto,
  esEtapaDeModulos, modulosHechos, textoModulos,
} from "../app/lib/calidad.js";
import { noConformidadBody, configPatchBody } from "../app/lib/schemas.ts";
import { validarPatch } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: TableroOt } = await import("../app/components/TableroOt.jsx");
const { default: NoConformidades, defectosRepetidos } = await import("../app/components/NoConformidades.jsx");
const { default: DefectosEditor } = await import("../app/components/DefectosEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const ncApi = await import("../app/api/no-conformidades/route.js");
const configApi = await import("../app/api/config-empresa/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CSV_URL = "https://files.example.com/ot.csv";

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸" },
  { codigo: 1, nombre: "Corte", icon: "✂️", unidad: "placas" },
  { codigo: 2, nombre: "Canto", icon: "📏", unidad: "metros" },
  { codigo: 5, nombre: "Armado", icon: "🔧", unidad: "módulos" },
];
const DIVISIONES = [{ id: "muebles", label: "Muebles", ruta_etapas: [1, 2, 5] }];

// ─── Módulos ───

test("planilla — lee la columna de módulos y suma los ítems de una OT", () => {
  const { filas } = parseCsvProyectos([
    "OT,CLIENTE,CANT,MÓDULOS",
    "M-7495,Siciliano,1,8",
    "M-7495,Siciliano,1,4",
    "M-7500,Ana,2,",
  ].join("\n"));
  const ot = (n) => filas.find((f) => f.ot === n);
  assert.equal(ot("M-7495").total_modulos, 12);
  assert.equal(ot("M-7495").cantidad, 2, "CANT sigue siendo la cantidad");
  assert.equal(ot("M-7500").total_modulos, null);
});

test("planilla — «Cant. módulos» no se confunde con la cantidad; sin columna no se manda", () => {
  let { filas } = parseCsvProyectos("OT,CANT. MODULOS\nM-1,6\n");
  assert.equal(filas[0].total_modulos, 6);
  assert.equal(filas[0].cantidad, null);
  ({ filas } = parseCsvProyectos("OT,CANT\nM-1,6\n"));
  assert.ok(!("total_modulos" in filas[0]), "sin columna la clave no va: no pisa lo cargado a mano");
  ({ filas } = parseCsvProyectos("OT,MODULOS\nM-1,2.5\nM-2,abc\n"));
  assert.equal(filas[0].total_modulos, null, "con decimales no vale");
  assert.equal(filas[1].total_modulos, null);
});

async function sincronizar(planilla) {
  const subidas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: planilla }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: (u, o) => { if (o.method === "POST") subidas.push(...JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" });
  await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  return subidas;
}

test("sync — manda el total de módulos solo si la planilla tiene la columna", async () => {
  let subidas = await sincronizar("OT,CLIENTE,MÓDULOS\nM-7495,Siciliano,12\nM-7500,Ana,\n");
  assert.deepEqual(subidas.map((r) => r.total_modulos), [12, null]);
  subidas = await sincronizar("OT,CLIENTE\nM-7495,Siciliano\n");
  assert.ok(subidas.every((r) => !("total_modulos" in r)));
});

test("módulos — etapas medidas en módulos, suma por OT y texto «3 de 12»", () => {
  assert.equal(esEtapaDeModulos({ unidad: "Módulos" }), true);
  assert.equal(esEtapaDeModulos({ unidad: "modulo" }), true);
  assert.equal(esEtapaDeModulos({ unidad: "placas" }), false);
  assert.equal(esEtapaDeModulos({}), false);
  const m = modulosHechos([
    { codigo_proyecto: "7495", etapa: 5, cantidad: 2 },
    { codigo_proyecto: "7495", etapa: 5, cantidad: 1 },
    { codigo_proyecto: "7495", etapa: 5, cantidad: null },
    { codigo_proyecto: "7495", etapa: 0, cantidad: 4 },
  ]);
  assert.equal(m.get("7495|5"), 3);
  assert.equal(m.has("7495|0"), false, "las paradas no cuentan");
  assert.equal(textoModulos(3, 12), "3 de 12");
  assert.equal(textoModulos(undefined, 12), "0 de 12");
  assert.equal(textoModulos(3, null), "3");
});

test("total de módulos — se valida al editar la OT", () => {
  assert.equal(validarPatch("proyectos", { total_modulos: 12 }), null);
  assert.equal(validarPatch("proyectos", { total_modulos: null }), null);
  assert.equal(validarPatch("proyectos", { total_modulos: 2.5 })?.status, 400);
  assert.equal(validarPatch("proyectos", { total_modulos: -1 })?.status, 400);
});

test("tablero — «Armado 3 de 12» y piezas no conformes sin decidir", async () => {
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    if (path.startsWith("registro_actividades")) {
      return new Response(JSON.stringify({ data: [{ codigo_proyecto: "7495", etapa: 5, cantidad: 2 }, { codigo_proyecto: "7495", etapa: 5, cantidad: 1 }] }), { status: 200 });
    }
    if (path.startsWith("no_conformidades")) {
      assert.match(path, /decision=is\.null/);
      return new Response(JSON.stringify({ data: [{ ot: "7495" }, { ot: "7495" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<TableroOt proyectos={[{ id: 1, ot: "7495", division: "muebles", total_modulos: 12 }]} empresaId={E} etapas={ETAPAS} divisiones={DIVISIONES} checklist={[]} />);
  await waitFor(() => assert.ok(screen.getByText(/Armado 3 de 12/)));
  assert.ok(screen.getByText(/2 piezas no conformes sin decidir/));
});

// ─── Defectos ───

test("defectos — sin lista propia se usan los generales; la de fábrica toma las etapas de la empresa", () => {
  assert.deepEqual(defectosDe([]), DEFECTOS_DEFECTO);
  assert.deepEqual(
    normalizarDefectos([{ cod: "k1", nombre: " Canto despegado ", origen: 2 }, { cod: "K1", nombre: "Repetido" }, { cod: "LARGO", nombre: "x" }, { cod: "D1", nombre: "Golpe", origen: 0 }]),
    [{ cod: "K1", nombre: "Canto despegado", origen: 2 }, { cod: "D1", nombre: "Golpe", origen: null }],
  );
  const fabrica = defectosFabricaPara(ETAPAS);
  assert.equal(fabrica.length, DEFECTOS_FABRICA.length);
  assert.equal(fabrica.find((d) => d.cod === "C1").origen, 1);
  assert.equal(fabrica.find((d) => d.cod === "K1").origen, 2);
  assert.equal(fabrica.find((d) => d.cod === "P1").origen, null, "la empresa no tiene etapa Procesos");
  assert.equal(nombreDefecto(fabrica, "K2"), "Canto en lado equivocado o faltante");
  assert.equal(nombreDefecto(fabrica, "ZZ"), "ZZ");
});

test("validación — no conformidades y lista de defectos", () => {
  assert.ok(noConformidadBody.safeParse({ accion: "crear", ot: 7495, defecto: "k1", cantidad: 2, etapa_detecta: 5, etapa_origen: 2 }).success);
  assert.equal(noConformidadBody.parse({ accion: "crear", ot: 7495, defecto: "k1" }).defecto, "K1");
  assert.ok(!noConformidadBody.safeParse({ accion: "crear", ot: "7495", defecto: "MUY LARGO" }).success);
  assert.ok(!noConformidadBody.safeParse({ accion: "crear", ot: "7495", defecto: "K1", cantidad: 0 }).success);
  assert.ok(noConformidadBody.safeParse({ accion: "decidir", id: 3, decision: "usar_igual", minutos_retrabajo: 15 }).success);
  assert.ok(noConformidadBody.safeParse({ accion: "decidir", id: 3, decision: null }).success, "se puede volver a «sin decidir»");
  assert.ok(!noConformidadBody.safeParse({ accion: "decidir", id: 3, decision: "regalar" }).success);
  assert.ok(configPatchBody.safeParse({ action: "update_defectos", defectos: defectosFabricaPara(ETAPAS) }).success);
});

test("migración 101 — total de módulos y tabla de no conformidades con RLS por empresa", () => {
  const sql = readFileSync(new URL("../supabase/migrations/101_modulos_no_conformidades.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.proyectos add column if not exists total_modulos integer/);
  assert.match(sql, /create table if not exists public\.no_conformidades/);
  assert.match(sql, /defecto ~ '\^\[A-Z0-9\]\{1,4\}\$'/);
  assert.match(sql, /decision in \('reprocesar', 'rehacer', 'usar_igual', 'descartar'\)/);
  assert.match(sql, /alter table public\.no_conformidades enable row level security/);
  assert.match(sql, /using \(empresa_id = \(current_setting\('request\.jwt\.claims', true\)::json->>'eid'\)::uuid\)/);
  assert.match(sql, /grant select, insert, update, delete on public\.no_conformidades to authenticated/);
  assert.match(sql, /grant usage, select on sequence public\.no_conformidades_id_seq to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Operario ───

test("Pieza con defecto — el operario elige el defecto, se propone el origen y queda registrada", async () => {
  const enviados = [];
  global.fetch = async (url, opts) => {
    enviados.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true, no_conformidad: { id: 1 } }), { status: 200 });
  };
  render(
    <ActividadScreen
      tareaActiva={{ id: 70, etapa: 5, codigo_proyecto: "7495", hora_inicio: new Date().toISOString(), tipo: "N" }}
      historial={[]} etapas={ETAPAS} defectos={defectosFabricaPara(ETAPAS)} proyectos={[{ ot: "7495", cliente: "Siciliano" }]}
      loading={false} elapsed={0} usuario={{ id: "emp-nc" }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async () => {}} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
    />
  );
  fireEvent.click(screen.getByText(/Pieza con defecto/));
  fireEvent.click(screen.getByText("Canto despegado o con rebaba"));
  assert.equal(screen.getByLabelText("¿En qué etapa se originó?").value, "2", "propone Canto");
  fireEvent.change(screen.getByLabelText("Pieza (opcional)"), { target: { value: "M.izq-41" } });
  fireEvent.click(screen.getByText("Registrar pieza no conforme"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.match(enviados[0].url, /\/api\/no-conformidades$/);
  assert.deepEqual(enviados[0].body, { accion: "crear", ot: "7495", defecto: "K1", pieza: "M.izq-41", cantidad: 1, etapa_detecta: 5, etapa_origen: 2, nota: null });
  await waitFor(() => assert.ok(screen.getByText(/Llevala a la zona de no conformes/)));
});

// ─── Encargado ───

test("no conformes — el encargado decide y ve los defectos que más se repiten", async () => {
  const decisiones = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(url).includes("/api/no-conformidades")) {
      decisiones.push(body);
      return new Response(JSON.stringify({ ok: true, no_conformidad: { id: body.id, decision: body.decision } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [
      { id: 1, ot: "7495", defecto: "K1", cantidad: 3, etapa_detecta: 5, etapa_origen: 2, created_at: "2026-10-13T10:00:00Z", decision: null },
      { id: 2, ot: "7495", defecto: "C1", cantidad: 1, created_at: "2026-10-12T10:00:00Z", decision: "rehacer", minutos_retrabajo: 20 },
    ] }), { status: 200 });
  };
  const defectos = defectosFabricaPara(ETAPAS);
  render(<NoConformidades empresaId={E} proyectos={[{ ot: "7495", cliente: "Siciliano" }]} etapas={ETAPAS} defectos={defectos} />);
  await waitFor(() => assert.ok(screen.getByText(/1 sin decidir/)));
  assert.ok(screen.getByText(/20 min de retrabajo/));
  assert.ok(screen.getByText(/Detectada en Armado · origen Canto/));
  assert.ok(screen.getByText("Medida fuera de tolerancia"), "el resumen de repetidos cuenta también las decididas");
  assert.equal(screen.queryAllByText(/· 1 pieza/).length, 0, "la ya decidida no aparece en «Sin decidir»");
  fireEvent.change(screen.getByLabelText("Minutos de retrabajo"), { target: { value: "15" } });
  fireEvent.click(screen.getByText(/Reprocesar/));
  await waitFor(() => assert.equal(decisiones.length, 1));
  assert.deepEqual(decisiones[0], { accion: "decidir", id: 1, decision: "reprocesar", minutos_retrabajo: 15 });
  await waitFor(() => assert.ok(screen.getByText(/No hay piezas esperando decisión/)));
  assert.deepEqual(defectosRepetidos([{ defecto: "K1", cantidad: 3 }, { defecto: "C1", cantidad: 1 }, { defecto: "K1", cantidad: 1 }], defectos).map((r) => [r.cod, r.piezas]), [["K1", 4], ["C1", 1]]);
});

test("pantalla de defectos — cargar los de fábrica y guardar", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    pedidos.push(body);
    return new Response(JSON.stringify({ defectos: body.defectos }), { status: 200 });
  };
  const guardados = [];
  render(<DefectosEditor defectos={[]} etapas={ETAPAS} onGuardados={(l) => guardados.push(l)} />);
  assert.ok(screen.getByText(/Defectos generales/));
  fireEvent.click(screen.getByText(/Usar los códigos de fábrica/));
  fireEvent.click(screen.getByText("Guardar defectos"));
  await waitFor(() => assert.equal(guardados.length, 1));
  assert.equal(pedidos[0].action, "update_defectos");
  assert.deepEqual(pedidos[0].defectos.map((d) => d.cod), DEFECTOS_FABRICA.map((d) => d.cod));
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function ncReq(body, t) {
  return new Request("http://localhost/api/no-conformidades", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body),
  });
}

function mockNc({ existe = true, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: existe ? [{ id: 1, ot: "7495" }] : [] }) },
    { match: (u, o) => u.includes("/rest/v1/no_conformidades") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ id: 3 }] }) },
    {
      match: (u, o) => u.includes("/rest/v1/no_conformidades") && ["POST", "PATCH", "DELETE"].includes(o?.method),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        escrito.push({ metodo: o.method, url: u, body: o.body ? JSON.parse(o.body) : null });
        return { status: 200, body: o.body ? [JSON.parse(o.body)] : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/no-conformidades — el operario registra con su empresa y su nombre", async () => {
  const escrito = mockNc();
  const res = await ncApi.POST(ncReq({ accion: "crear", ot: "7495", defecto: "K1", etapa_detecta: 5, etapa_origen: 2 }, await token("operativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.creada_por, EMP);
  assert.equal(escrito[0].body.cantidad, 1);
  assert.equal(escrito[0].body.decision, undefined, "la decisión no la toma el operario");
});

test("/api/no-conformidades — una OT que no existe no se registra", async () => {
  const escrito = mockNc({ existe: false });
  const res = await ncApi.POST(ncReq({ accion: "crear", ot: "9999", defecto: "K1" }, await token("operativo")));
  assert.equal(res.status, 404);
  assert.equal(escrito.length, 0);
});

test("/api/no-conformidades — decidir y borrar son del encargado", async () => {
  mockNc();
  for (const body of [{ accion: "decidir", id: 3, decision: "rehacer" }, { accion: "borrar", id: 3 }]) {
    const res = await ncApi.POST(ncReq(body, await token("operativo")));
    assert.equal(res.status, 403, body.accion);
  }
  let escrito = mockNc();
  let res = await ncApi.POST(ncReq({ accion: "decidir", id: 3, decision: "rehacer", minutos_retrabajo: 30 }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, new RegExp(`id=eq\\.3&empresa_id=eq\\.${E}`));
  assert.equal(escrito[0].body.decision, "rehacer");
  assert.equal(escrito[0].body.decidida_por, EMP);
  assert.equal(escrito[0].body.minutos_retrabajo, 30);

  escrito = mockNc();
  res = await ncApi.POST(ncReq({ accion: "borrar", id: 3 }, await token("administrativo")));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "DELETE");
});

test("/api/no-conformidades — sin la migración 101 avisa qué falta", async () => {
  mockNc({ falla: 'relation "public.no_conformidades" does not exist' });
  const res = await ncApi.POST(ncReq({ accion: "crear", ot: "7495", defecto: "K1" }, await token("operativo")));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 101/);
});

test("config-empresa — guarda los defectos y rechaza códigos repetidos", async () => {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "POST", respond: (u, o) => { escrito.push(JSON.parse(o.body)); return { status: 200, body: [{}] }; } },
  ]);
  const req = (body, t) => new Request("http://localhost/api/config-empresa", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  let res = await configApi.PATCH(req({ action: "update_defectos", defectos: [{ cod: "k1", nombre: "Canto despegado", origen: 2 }] }, await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).defectos, [{ cod: "K1", nombre: "Canto despegado", origen: 2 }]);
  assert.equal(escrito[0].clave, "defectos");
  res = await configApi.PATCH(req({ action: "update_defectos", defectos: [{ cod: "K1", nombre: "a" }, { cod: "k1", nombre: "b" }] }, await token("gerencial")));
  assert.equal(res.status, 400);
  res = await configApi.PATCH(req({ action: "update_defectos", defectos: [] }, await token("operativo")));
  assert.equal(res.status, 403);
});
