// tests/flota-alertas.test.jsx — Mantenimiento, parte 30 (ítem 43, migración
// 128): alertas de la flota. Cada aspecto se revisa cada tantos días o km (lo
// que pase primero); un checklist que revisa la sección la pone al día. Se ven
// en la ficha, en 🔔 Alertas, en el Panel de control y llegan al celular una
// vez por día (sin repetir lo ya avisado). Solo avisan.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  FRECUENCIAS, alertasVehiculo, avisoDelDia, estadoRevision, firmaAvisos, frecuenciasDe, textoAlerta, textoAvisos, ultimasRevisiones, urgentes,
} from "../app/lib/alertasFlota.js";
import { textoVencimiento } from "../app/lib/flota.js";
import { flotaBody } from "../app/lib/schemas.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.CRON_SECRET = "test-cron-secret";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

before(() => {});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/flota/route.js");
const cron = await import("../app/api/cron/flota-alertas/route.js");
const { revisarFlota } = await import("../app/lib/flotaAlertasServidor.js");
const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");
const { default: FlotaScreen } = await import("../app/components/FlotaScreen.jsx");
const { hoyArg } = await import("../app/lib/dates.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CHOFER = "33333333-3333-3333-3333-333333333333";
const HOY = "2026-10-22";
const f = (id) => frecuenciasDe({}).find((x) => x.id === id);
// Un checklist hecho tal día a las 10 de Argentina
const chk = (vehiculo_id, fecha, km, secciones) => ({ vehiculo_id, created_at: `${fecha}T13:00:00Z`, km, secciones });

// ─── Reglas ───

test("frecuencias: las de fábrica y lo que cambia la empresa por vehículo", () => {
  assert.deepEqual(FRECUENCIAS.map((x) => x.id), ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion", "service"]);
  const propias = frecuenciasDe({ frecuencias: { fluidos: { dias: 10 }, service: { km: 15000 } } });
  assert.deepEqual([propias[1].dias, propias[1].km], [10, 2000], "cambia los días, los km quedan de fábrica");
  assert.equal(propias.find((x) => x.id === "service").km, 15000);
});

test("estadoRevision: por días o por km, lo que pase primero", () => {
  assert.deepEqual(estadoRevision(f("fluidos"), null, 1000, HOY), { nivel: "pronto", dias: null, km: null, texto: "Nunca se revisó" });
  assert.equal(estadoRevision(f("service"), null, 1000, HOY).texto, "Falta cargar el último service");
  // Fluidos cada 15 días: revisado el 1/10 → tocaba el 16/10
  assert.deepEqual(estadoRevision(f("fluidos"), { fecha: "2026-10-01", km: 1000 }, 1500, HOY), { nivel: "vencido", dias: -6, km: 1500, texto: "Atrasado 6 días" });
  assert.equal(estadoRevision(f("fluidos"), { fecha: "2026-10-21", km: 1000 }, 1500, HOY).nivel, "ok");
  // ...o cada 2000 km: se pasó por 100 km aunque por fecha esté bien
  assert.deepEqual(estadoRevision(f("fluidos"), { fecha: "2026-10-21", km: 1000 }, 3100, HOY), { nivel: "vencido", dias: 14, km: -100, texto: "Se pasó por 100 km" });
  assert.equal(estadoRevision(f("fluidos"), { fecha: "2026-10-21", km: 1000 }, 2850, HOY).texto, "Faltan 150 km");
  assert.equal(estadoRevision(f("limpieza"), { fecha: "2026-10-15", km: null }, null, HOY).texto, "Toca hoy");
  assert.equal(estadoRevision(f("luces"), { fecha: "2026-10-01", km: null }, null, HOY).texto, "Toca en 9 días");
  // Solo por km, sin días: no se rompe
  assert.equal(estadoRevision({ ...f("service"), dias: null }, { fecha: "2026-01-01", km: 1000 }, null, HOY).texto, "Falta cargar los kilómetros");
});

test("ultimasRevisiones y alertasVehiculo: el checklist pone al día sus secciones", () => {
  const ult = ultimasRevisiones([chk(7, "2026-10-01", 1000, ["fluidos", "luces"]), chk(7, "2026-10-20", 1800, ["fluidos"])]);
  assert.deepEqual(ult, { fluidos: { fecha: "2026-10-20", km: 1800 }, luces: { fecha: "2026-10-01", km: 1000 } });

  // Sin ningún checklist: un solo aviso, no siete
  const v = { id: 7, patente: "AB123CD", km: 2000, responsable_id: CHOFER };
  let a = alertasVehiculo(v, { hoy: HOY });
  assert.deepEqual(a.filter((x) => x.tipo === "revision").map((x) => x.clave), ["sin-checklist", "rev-service"]);

  // Con checklists: una revisión por aspecto; el de otro vehículo no cuenta
  a = alertasVehiculo({ ...v, service_fecha: "2026-06-01", service_km: 500 }, {
    hoy: HOY,
    checklists: [chk(7, "2026-10-20", 1800, ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion"]), chk(9, "2026-10-21", 10, ["limpieza"])],
  });
  const rev = Object.fromEntries(a.filter((x) => x.tipo === "revision").map((x) => [x.aspecto, x]));
  assert.equal(Object.keys(rev).length, 7);
  assert.equal(rev.limpieza.nivel, "ok");
  assert.equal(rev.service.nivel, "ok", "service el 1/6 a los 500 km: faltan 8500 km y más de 200 días");
  const v2 = { ...v, km: 11000, service_fecha: "2026-06-01", service_km: 500 };
  const s = alertasVehiculo(v2, { hoy: HOY, checklists: [chk(7, "2026-10-20", 1800, ["limpieza"])] }).find((x) => x.aspecto === "service");
  assert.deepEqual([s.nivel, s.detalle], ["vencido", "Se pasó por 500 km"]);
  assert.equal(textoAlerta(s, textoVencimiento), "Service: se pasó por 500 km");
});

test("avisoDelDia: avisa lo nuevo, no repite lo ya avisado y avisa cuando 🟡 pasa a 🔴", () => {
  const alertas = [
    { clave: "rev-fluidos", tipo: "revision", texto: "Fluidos", detalle: "Atrasado 2 días", nivel: "vencido", dias: -2 },
    { clave: "rev-luces", tipo: "revision", texto: "Luces", detalle: "Toca en 3 días", nivel: "pronto", dias: 3 },
    { clave: "rev-limpieza", tipo: "revision", texto: "Limpieza", detalle: "Toca en 5 días", nivel: "ok", dias: 5 },
  ];
  const firma = firmaAvisos(alertas);
  assert.equal(firma, "rev-fluidos:vencido|rev-luces:pronto");
  assert.deepEqual(urgentes(alertas).map((x) => x.clave), ["rev-fluidos", "rev-luces"]);

  let r = avisoDelDia({ aviso_firma: null }, alertas);
  assert.deepEqual([r.nuevas.length, r.cambio], [2, true]);
  r = avisoDelDia({ aviso_firma: firma }, alertas);
  assert.deepEqual([r.nuevas.length, r.cambio], [0, false], "lo mismo de ayer no se repite");
  r = avisoDelDia({ aviso_firma: "rev-fluidos:pronto|rev-luces:pronto" }, alertas);
  assert.deepEqual(r.nuevas.map((x) => x.clave), ["rev-fluidos"]);
  r = avisoDelDia({ aviso_firma: firma }, []);
  assert.deepEqual([r.nuevas.length, r.cambio, r.firma], [0, true, ""], "si se puso al día se guarda sin avisar");

  assert.equal(textoAvisos(alertas, textoVencimiento, 1), "Fluidos: atrasado 2 días · y 2 más");
});

test("validación: frecuencias y último service", () => {
  const base = { accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto" };
  const ok = flotaBody.safeParse({ ...base, service_fecha: "2026-06-01", service_km: 500, frecuencias: { fluidos: { dias: 10 } } });
  assert.equal(ok.success, true);
  assert.deepEqual([ok.data.service_fecha, ok.data.service_km, ok.data.frecuencias], ["2026-06-01", 500, { fluidos: { dias: 10 } }]);
  assert.equal(flotaBody.safeParse({ ...base, frecuencias: { aceite: { dias: 10 } } }).success, false, "aspecto que no existe");
  assert.equal(flotaBody.safeParse({ ...base, frecuencias: { fluidos: { dias: 0 } } }).success, false);
  assert.equal(flotaBody.safeParse({ ...base, service_km: -1 }).success, false);

  const sql = readFileSync(new URL("../supabase/migrations/128_alertas_flota.sql", import.meta.url), "utf8");
  for (const c of ["frecuencias", "service_fecha", "service_km", "aviso_firma", "aviso_at", "'flota-alertas'"]) assert.ok(sql.includes(c), c);
  assert.match(sql, /do \$mig\$/);
});

// ─── /api/flota ───

function mockRuta({ sin128 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (o?.method === "PATCH" || o?.method === "POST") {
          if (sin128) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'frecuencias' column of 'vehiculos' in the schema cache" } };
          escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) });
          return { status: 200, body: [{ id: 7 }] };
        }
        return { status: 200, body: [{ km: 1000 }] };
      },
    },
  ]);
  return escrito;
}
const req = async (body) => {
  const { token } = await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" });
  return new Request("http://localhost/api/flota", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
};

test("/api/flota vehiculo_guardar — guarda el último service y las frecuencias; sin la 128 avisa", async () => {
  const escrito = mockRuta();
  const res = await api.POST(await req({ accion: "vehiculo_guardar", id: 7, patente: "AB123CD", tipo: "auto", km: 1000, service_fecha: "2026-06-01", service_km: 500, frecuencias: { fluidos: { dias: 10 } } }));
  assert.equal(res.status, 200);
  const b = escrito[0].body;
  assert.deepEqual([b.service_fecha, b.service_km, b.frecuencias], ["2026-06-01", 500, { fluidos: { dias: 10 } }]);

  mockRuta({ sin128: true });
  const r2 = await api.POST(await req({ accion: "vehiculo_guardar", id: 7, patente: "AB123CD", tipo: "auto", frecuencias: {} }));
  assert.equal(r2.status, 409);
  assert.match((await r2.json()).error, /migración 128/);
});

// ─── Aviso diario ───

function mockCron({ vehiculos, checklists = [], papeles = [], empleados = [], parches, tokens = [] }) {
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?activa=eq.true"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? [{ id: E, slug: "acme" }] : [] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/vehiculos") && o?.method === "PATCH", respond: (u, o) => { parches.push({ url: u, body: JSON.parse(o.body) }); return { status: 200, body: [] }; } },
    { match: (u) => u.includes("/rest/v1/vehiculos"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? vehiculos : [] }) },
    { match: (u) => u.includes("/rest/v1/vehiculo_papeles"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? papeles : [] }) },
    { match: (u) => u.includes("/rest/v1/vehiculo_checklists"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? checklists : [] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? (u.includes("rol=in.") ? [{ legajo: 1 }] : empleados) : [] }) },
    { match: (u) => u.includes("/rest/v1/push_tokens"), respond: (u) => ({ status: 200, body: u.includes("offset=0") ? tokens.filter((t) => u.includes(`legajo=in.(${t.legajo})`)) : [] }) },
  ]);
}

test("revisarFlota — avisa al chofer y a gerencia lo nuevo, guarda la firma y al otro día no repite", async () => {
  const parches = [];
  const enviados = [];
  const messaging = { send: async (m) => { enviados.push(m); } };
  const vehiculos = [
    { id: 7, patente: "AB123CD", km: 3100, responsable_id: CHOFER, activo: true, aviso_firma: null },
    { id: 8, patente: "AA999ZZ", km: 100, activo: true, aviso_firma: null },
  ];
  const papeles = [
    { id: 1, vehiculo_id: 7, tipo: "seguro", vencimiento: "2099-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, vehiculo_id: 7, tipo: "itv", resultado: "apto", vencimiento: "2099-01-01", created_at: "2026-01-01T00:00:00Z" },
  ];
  const todas = ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion"];
  const checklists = [chk(7, "2026-10-21", 1000, todas)];
  // El 8 ya fue avisado de lo mismo: no se repite
  const firma8 = firmaAvisos(alertasVehiculo(vehiculos[1], { hoy: HOY }));
  vehiculos[1].aviso_firma = firma8;
  mockCron({
    vehiculos, papeles, checklists, parches,
    empleados: [{ id: CHOFER, nombre: "Juan", legajo: 12, licencia_vencimiento: "2099-01-01" }],
    tokens: [{ legajo: 12, token: "chofer" }, { legajo: 1, token: "gerente" }],
  });
  const r = await revisarFlota({ id: E, slug: "acme" }, HOY, { messaging });
  assert.equal(r.avisados, 1, "solo el 7 tiene algo nuevo");
  // Fluidos: 1000 + 2000 = 3000 < 3100 km → vencido; service sin cargar → pronto
  const alChofer = enviados.find((m) => m.token === "chofer");
  assert.match(alChofer.notification.title, /AB123CD/);
  assert.match(alChofer.notification.body, /Fluidos: se pasó por 100 km/);
  const aGerencia = enviados.find((m) => m.token === "gerente");
  assert.match(aGerencia.notification.title, /1 vehículo con algo vencido/);
  assert.match(aGerencia.notification.body, /AB123CD: Fluidos/);
  assert.equal(parches.length, 1);
  assert.match(parches[0].url, /id=eq\.7&empresa_id=eq\./);
  assert.match(parches[0].body.aviso_firma, /rev-fluidos:vencido/);

  // Al otro día, con la firma guardada, no sale nada
  vehiculos[0].aviso_firma = parches[0].body.aviso_firma;
  enviados.length = 0;
  parches.length = 0;
  mockCron({ vehiculos, papeles, checklists, parches, empleados: [{ id: CHOFER, nombre: "Juan", legajo: 12, licencia_vencimiento: "2099-01-01" }], tokens: [{ legajo: 12, token: "chofer" }] });
  const r2 = await revisarFlota({ id: E, slug: "acme" }, HOY, { messaging });
  assert.deepEqual([r2.avisados, enviados.length, parches.length], [0, 0, 0]);
});

test("cron/flota-alertas — pide la clave, está en vercel.json y en el monitoreo", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await cron.GET(new Request("http://localhost/api/cron/flota-alertas"))).status, 401);
  const parches = [];
  mockCron({ vehiculos: [{ id: 8, patente: "AA999ZZ", activo: true, aviso_firma: null }], parches });
  const json = await (await cron.GET(new Request("http://localhost/api/cron/flota-alertas", { headers: { authorization: "Bearer test-cron-secret" } }))).json();
  assert.deepEqual([json.ok, json.empresas, json.avisados, json.errores], [true, 1, 1, 0]);
  assert.equal(parches.length, 1, "guarda lo avisado aunque no haya Firebase");
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/flota-alertas" && c.schedule === "0 10 * * *"));
  assert.ok(CRONS_ESPERADOS["flota-alertas"]);
});

// ─── Pantalla ───

test("Flota — 🔔 Alertas junta lo de toda la flota; la ficha muestra las revisiones", async () => {
  const hoy = hoyArg();
  const VEH = [{ id: 7, patente: "AB123CD", tipo: "camioneta", km: 3100, responsable_id: CHOFER, activo: true }];
  const PAP = [
    { id: 1, vehiculo_id: 7, tipo: "seguro", vencimiento: "2099-01-01", fotos: [], created_at: "2026-01-01T00:00:00Z" },
    { id: 2, vehiculo_id: 7, tipo: "itv", resultado: "apto", vencimiento: "2099-01-01", fotos: [], created_at: "2026-01-01T00:00:00Z" },
  ];
  const CHK = [{ id: 1, ...chk(7, hoy, 1000, ["limpieza", "fluidos", "neumaticos", "luces", "itv", "documentacion"]), items: [], fotos: [] }];
  global.fetch = async (url, opts = {}) => {
    const path = (opts.body ? JSON.parse(opts.body) : {}).path || "";
    const data = path.startsWith("vehiculo_papeles") ? PAP
      : path.startsWith("vehiculo_checklists") ? CHK
        : path.startsWith("vehiculos") ? VEH
          : path.startsWith("empleados") ? [{ id: CHOFER, nombre: "Juan Pérez", licencia_vencimiento: "2099-01-01" }] : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} vistaInicial="alertas" />);
  const lista = await screen.findByRole("list", { name: "Alertas de la flota" });
  const filas = [...lista.querySelectorAll("li")].map((li) => li.textContent);
  assert.match(filas[0], /🔴Fluidos: se pasó por 100 km.*AB123CD.*Juan Pérez/, "lo vencido primero");
  assert.ok(filas.some((t) => /Service: falta cargar el último service/.test(t)));

  fireEvent.click(screen.getByLabelText(/AB123CD: Fluidos/));
  const rev = await screen.findByRole("list", { name: "Revisiones" });
  assert.match(rev.textContent, /Limpieza.*✅/);
  assert.match(rev.textContent, /Fluidos.*Se pasó por 100 km/);
  await waitFor(() => assert.ok(screen.getByText("AB123CD")));
});
