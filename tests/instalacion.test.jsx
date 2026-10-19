// tests/instalacion.test.jsx — Seguimiento de OT por escaneo, parte 24b
// (migración 117): reporte diario del jefe de instalaciones, % de instalación
// por módulos colocados y pendientes que restan, y la pestaña Instalaciones
// solo para los instaladores.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { avanceInstalacion, modulosDeOt, SIN_MODULO } from "../app/lib/instalacion.js";
import { reporteInstalacionBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { getItems } = await import("../app/components/nav/BottomNav.jsx");
const { ReporteInstalacion, default: InstalacionesScreen } = await import("../app/components/screens/InstalacionesScreen.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/instalacion/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/obra.jpg`;

// 4 módulos iguales (dos piezas de 1 m² cada uno) y una pieza suelta
const PIEZAS = [
  ...["M1", "M2", "M3", "M4"].flatMap((m, i) => [
    { id: i * 10 + 1, nombre: `${m}-lateral`, modulo: m, l1: 1000, l2: 500, unidad: 1, de: 1 },
    { id: i * 10 + 2, nombre: `${m}-tapa`, modulo: m, l1: 1000, l2: 500, unidad: 1, de: 1 },
  ]),
];

// ─── Cálculo ───

test("% — 4 módulos colocados con un ajuste pendiente del 1% cada uno = 96%", () => {
  const instalados = ["M1", "M2", "M3", "M4"];
  assert.equal(avanceInstalacion({ piezas: PIEZAS, instalados }).porcentaje, 100);
  const pendientes = instalados.map((modulo) => ({ modulo, descripcion: "Tiras de ajuste" }));
  const a = avanceInstalacion({ piezas: PIEZAS, instalados, pendientes });
  assert.equal(a.porcentaje, 96);
  assert.equal(a.colocados, 4);
  assert.equal(a.total, 4);
  assert.equal(a.porArea, true);
  // Resuelto, vuelve a sumar
  assert.equal(avanceInstalacion({ piezas: PIEZAS, instalados, pendientes: pendientes.map((p) => ({ ...p, resuelto: true })) }).porcentaje, 100);
});

test("% — cada módulo pesa por su superficie; un pendiente con piezas resta la superficie de esas piezas", () => {
  const piezas = [
    { id: 1, nombre: "Grande-lateral", modulo: "Grande", l1: 2000, l2: 600 }, // 1,2 m²
    { id: 2, nombre: "Grande-tapa", modulo: "Grande", l1: 1000, l2: 600 },    // 0,6 m²
    { id: 3, nombre: "Chico-frente", modulo: "Chico", l1: 1000, l2: 200 },    // 0,2 m²
  ];
  assert.equal(avanceInstalacion({ piezas, instalados: ["Grande"] }).porcentaje, 90);
  // Falta la tapa del grande: resta 0,6 de 1,8 m² del módulo
  assert.equal(avanceInstalacion({ piezas, instalados: ["Grande"], pendientes: [{ modulo: "Grande", piezas: [2] }] }).porcentaje, 60);
  // Un pendiente de la obra en general (sin módulo) no resta
  assert.equal(avanceInstalacion({ piezas, instalados: ["Grande"], pendientes: [{ descripcion: "Limpieza" }] }).porcentaje, 90);
  // Un módulo sin colocar no resta aunque tenga pendientes; no resta más de lo que pesa
  assert.equal(avanceInstalacion({ piezas, instalados: ["Grande"], pendientes: [{ modulo: "Chico", porcentaje: 50 }, { modulo: "Grande", porcentaje: 80 }, { modulo: "Grande", porcentaje: 80 }] }).porcentaje, 0);
});

test("módulos — salen de las piezas; sin medidas pesan por cantidad; sin módulo van a Sueltas", () => {
  const { porArea, modulos } = modulosDeOt([
    { id: 1, nombre: "a", modulo: "M2" }, { id: 2, nombre: "b", modulo: "M10" }, { id: 3, nombre: "c", modulo: null }, { id: 4, nombre: "d", modulo: "M2", l1: 100, l2: 100 },
  ]);
  assert.equal(porArea, false);
  assert.deepEqual(modulos.map((m) => [m.modulo, m.peso]), [["M2", 2], ["M10", 1], [SIN_MODULO, 1]]);
  assert.equal(avanceInstalacion({ piezas: [] }).porcentaje, null, "sin piezas no hay %");
});

test("formulario — valida el reporte", () => {
  const ok = reporteInstalacionBody.parse({ ot: 7038, modulos: ["M1"], pendientes: [{ descripcion: " Tiras ", modulo: "M1", porcentaje: 1.234 }], comentario: "" });
  assert.equal(ok.ot, "7038");
  assert.deepEqual(ok.pendientes[0], { descripcion: "Tiras", modulo: "M1", piezas: null, porcentaje: 1.23 });
  assert.equal(ok.comentario, null);
  assert.deepEqual(ok.fotos, []);
  assert.equal(reporteInstalacionBody.safeParse({ ot: "1", fotos: [FOTO, FOTO, FOTO, FOTO, FOTO] }).success, false);
  assert.equal(reporteInstalacionBody.safeParse({ ot: "1", pendientes: [{ descripcion: "x", porcentaje: 120 }] }).success, false);
});

test("migración 117 — tablas con RLS por empresa y pendientes con módulo", () => {
  const sql = readFileSync(new URL("../supabase/migrations/117_reportes_instalacion.sql", import.meta.url), "utf8");
  for (const t of ["reportes_instalacion", "modulos_instalados"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.match(sql, /unique \(empresa_id, ot, modulo\)/);
  for (const c of ["modulo", "piezas", "porcentaje", "reporte_id"]) assert.match(sql, new RegExp(`pendientes_obra add column if not exists ${c}`));
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

// ─── Barra de abajo ───

test("barra — Instalaciones solo para los instaladores", () => {
  assert.deepEqual(getItems("operativo", 0).map((i) => i.id), ["home", "mis-sols", "cuenta"]);
  assert.deepEqual(getItems("operativo", 0, undefined, { instalador: true }).map((i) => i.label), ["Inicio", "Instalaciones", "Permisos", "Mi cuenta"]);
  assert.equal(getItems("gerencial", 0, undefined, { instalador: true }).some((i) => i.id === "instalaciones"), false);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function req(t, { body, ot } = {}) {
  const url = `http://localhost/api/instalacion${ot ? `?ot=${ot}` : ""}`;
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function mock({ instalador = true, instalados = [], pendientes = [], reportes = [] } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?") && u.includes("select=es_instalador"), respond: () => ({ status: 200, body: [{ es_instalador: instalador }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Juan Instalador" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ ot: "7038", cliente: "Depto", obra: "Torre A" }] }) },
    {
      match: (u, o) => ["piezas_ot", "modulos_instalados", "pendientes_obra", "reportes_instalacion"].some((t) => u.includes(`/rest/v1/${t}`)) && (!o?.method || o.method === "GET"),
      respond: (u) => {
        leido.push(u);
        if (u.includes("/piezas_ot")) return { status: 200, body: u.includes("offset=0") ? PIEZAS : [] };
        if (u.includes("/modulos_instalados")) return { status: 200, body: instalados.map((modulo) => ({ modulo })) };
        if (u.includes("/reportes_instalacion")) return { status: 200, body: reportes };
        return { status: 200, body: pendientes };
      },
    },
    {
      match: (u, o) => o?.method === "POST" && ["modulos_instalados", "pendientes_obra", "reportes_instalacion"].some((t) => u.includes(`/rest/v1/${t}`)),
      respond: (u, o) => {
        const body = JSON.parse(o.body);
        escrito.push({ url: u, body });
        return { status: 201, body: Array.isArray(body) ? body : [{ id: 5, ...body }] };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/instalacion — un operario que no es instalador no entra", async () => {
  mock({ instalador: false });
  assert.equal((await api.GET(req(await token("operativo")))).status, 403);
  assert.equal((await api.POST(req(await token("operativo"), { body: { ot: "7038", modulos: ["M1"] } }))).status, 403);
});

test("/api/instalacion — estado de la OT: módulos, colocados y %", async () => {
  mock({ instalados: ["M1"], pendientes: [{ id: 9, modulo: "M1", descripcion: "Tiras", resuelto: false }] });
  const res = await api.GET(req(await token("operativo"), { ot: "7038" }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.modulos.map((m) => [m.modulo, m.instalado]), [["M1", true], ["M2", false], ["M3", false], ["M4", false]]);
  assert.equal(d.porcentaje, 24);
  assert.equal(d.pendientes.length, 1);
});

test("/api/instalacion — el reporte guarda módulos nuevos, pendientes y el % que quedó", async () => {
  const { escrito } = mock({ instalados: ["M1"] });
  const res = await api.POST(req(await token("operativo"), { body: {
    ot: "7038", modulos: ["M1", "M2", "M3", "M4"],
    pendientes: [{ descripcion: "Tiras de ajuste", modulo: "M2" }, { descripcion: "Limpieza final" }],
    comentario: "Se colocaron 3 módulos", fotos: [FOTO],
  } }));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.porcentaje, 99);
  const rep = escrito.find((x) => x.url.includes("reportes_instalacion")).body;
  assert.deepEqual(rep.modulos, ["M2", "M3", "M4"], "M1 ya estaba colocado");
  assert.equal(rep.avance, 99);
  assert.equal(rep.empleado_id, EMP);
  assert.deepEqual(escrito.find((x) => x.url.includes("modulos_instalados")).body.map((m) => m.modulo), ["M2", "M3", "M4"]);
  const pend = escrito.find((x) => x.url.includes("pendientes_obra")).body;
  assert.deepEqual(pend.map((p) => [p.descripcion, p.modulo, p.reporte_id]), [["Tiras de ajuste", "M2", 5], ["Limpieza final", null, 5]]);
});

test("/api/instalacion — rechaza módulos de otra OT, fotos de afuera y reportes vacíos", async () => {
  let { escrito } = mock();
  assert.equal((await api.POST(req(await token("operativo"), { body: { ot: "7038", modulos: ["Z9"] } }))).status, 400);
  assert.equal((await api.POST(req(await token("operativo"), { body: { ot: "7038", modulos: ["M1"], fotos: ["https://otro.sitio/a.jpg"] } }))).status, 400);
  assert.equal((await api.POST(req(await token("operativo"), { body: { ot: "7038" } }))).status, 400);
  assert.equal((await api.POST(req(await token("operativo"), { body: { ot: "7038", pendientes: [{ descripcion: "x", modulo: "M1", piezas: [21] }] } }))).status, 400, "pieza de otro módulo");
  assert.equal(escrito.length, 0);
});

test("/api/instalacion — historial: el instalador ve los suyos, gestión todos", async () => {
  let { leido } = mock({ reportes: [{ id: 5, ot: "7038", fecha: "2026-10-19", empleado_id: EMP, modulos: ["M1"], avance: 25 }], pendientes: [{ id: 9, reporte_id: 5, descripcion: "Tiras" }] });
  let d = await (await api.GET(req(await token("operativo")))).json();
  assert.equal(d.reportes[0].empleado, "Juan Instalador");
  assert.equal(d.reportes[0].pendientes[0].descripcion, "Tiras");
  assert.ok(leido.some((u) => u.includes("reportes_instalacion") && u.includes(`empleado_id=eq.${EMP}`)));
  ({ leido } = mock({ reportes: [] }));
  await api.GET(req(await token("gerencial")));
  assert.ok(leido.some((u) => u.includes("reportes_instalacion") && !u.includes("empleado_id=eq.")));
});

// ─── Pantalla ───

function mockPantalla({ reportes = [] } = {}) {
  const enviados = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/api/instalacion?ot="), respond: () => ({ status: 200, body: { ok: true, ...avanceInstalacion({ piezas: PIEZAS, instalados: ["M1"] }), pendientes: [] } }) },
    { match: (u, o) => u.endsWith("/api/instalacion") && o?.method === "POST", respond: (u, o) => { enviados.push(JSON.parse(o.body)); return { status: 200, body: { ok: true, porcentaje: 74 } }; } },
    { match: (u) => u.endsWith("/api/instalacion"), respond: () => ({ status: 200, body: { ok: true, reportes } }) },
  ]);
  return enviados;
}

test("pantalla — el botón de reporte arriba y el historial abajo", async () => {
  mockPantalla({ reportes: [{ id: 5, ot: "7038", fecha: "2026-10-19", empleado: "Juan", modulos: ["M1", "M2"], avance: 50, comentario: "Bien", fotos: [FOTO], pendientes: [{ id: 9, descripcion: "Tiras", modulo: "M2" }] }] });
  render(<InstalacionesScreen empresaId={E} />);
  assert.ok(screen.getByRole("button", { name: /Generar reporte/ }));
  assert.ok(await screen.findByText("OT 7038"));
  assert.ok(screen.getByText("50%"));
  assert.ok(screen.getByText(/Colocados: M1, M2/));
  assert.ok(screen.getByText(/Tiras · M2/));
});

test("reporte — tildar módulos y anotar un pendiente muestra el % antes de enviar", async () => {
  const enviados = mockPantalla();
  let enviado = null;
  render(<ReporteInstalacion ot="7038" onClose={() => {}} onEnviado={(d) => { enviado = d; }} />);
  const avance = await screen.findByRole("status", { name: "Avance de la instalación" });
  assert.match(avance.textContent, /25%/);
  const m1 = screen.getAllByRole("checkbox")[0];
  assert.equal(m1.disabled, true, "M1 ya estaba colocado");
  fireEvent.click(screen.getByRole("checkbox", { name: /M2/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /M3/ }));
  fireEvent.change(screen.getByLabelText("Qué quedó pendiente"), { target: { value: "Tiras de ajuste" } });
  fireEvent.change(screen.getByLabelText("Módulo del pendiente"), { target: { value: "M2" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Agregar pendiente" }));
  assert.match(avance.textContent, /74%/);
  fireEvent.click(screen.getByRole("button", { name: "Enviar reporte" }));
  await waitFor(() => assert.ok(enviado));
  assert.deepEqual(enviados[0], { ot: "7038", modulos: ["M2", "M3"], pendientes: [{ descripcion: "Tiras de ajuste", modulo: "M2", piezas: null, porcentaje: 1 }], comentario: null, fotos: [] });
});
