// tests/flota-arreglos.test.jsx — Mantenimiento, parte 31 (ítem 43, migración
// 129): arreglos que salen de los puntos en Mal del checklist (🔴 no puede
// circular · 🟡 arreglar pronto), resueltos con lo que se hizo, dónde, costo y
// factura; services y reparaciones sin checklist (el service pone al día la
// alerta); historial del vehículo y costo de mantenimiento por mes.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  alertasArreglos, arreglosDeChecklist, costosFlota, historialVehiculo, nombreMes, ultimoService, ultimosMeses,
} from "../app/lib/arreglosFlota.js";
import { alertasVehiculo, textoAlerta, urgentes } from "../app/lib/alertasFlota.js";
import { itemsChecklist } from "../app/lib/checklistVehiculo.js";
import { textoVencimiento, peorNivel } from "../app/lib/flota.js";
import { flotaBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/flota/route.js");
const { default: FichaVehiculo } = await import("../app/components/FichaVehiculo.jsx");
const { default: FlotaScreen } = await import("../app/components/FlotaScreen.jsx");
const { hoyArg } = await import("../app/lib/dates.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CHOFER = "33333333-3333-3333-3333-333333333333";
const OTRO = "44444444-4444-4444-4444-444444444444";
const HOY = "2026-10-22";

// ─── Reglas ───

test("arreglosDeChecklist: un arreglo por punto en Mal, con nota, foto y si puede circular", () => {
  const items = [
    { seccion: "luces", seccion_nombre: "Luces", punto: "bajas", nombre: "Bajas", estado: "bien" },
    { seccion: "luces", seccion_nombre: "Luces", punto: "altas", nombre: "Altas", estado: "mal", nota: "Quemada", foto: "https://x.test/f.jpg" },
    { seccion: "neumaticos", seccion_nombre: "Neumáticos", punto: "di", nombre: "Delantera izquierda", estado: "mal", nota: "Lisa", foto: "https://x.test/g.jpg", no_circula: true },
    { seccion: "fluidos", seccion_nombre: "Fluidos", punto: "aceite", nombre: "Aceite", estado: "revisar", nota: "Bajo", foto: "https://x.test/h.jpg" },
  ];
  assert.deepEqual(arreglosDeChecklist(items), [
    { seccion_nombre: "Luces", punto_nombre: "Altas", descripcion: "Altas: Quemada", foto: "https://x.test/f.jpg", prioridad: "pronto" },
    { seccion_nombre: "Neumáticos", punto_nombre: "Delantera izquierda", descripcion: "Delantera izquierda: Lisa", foto: "https://x.test/g.jpg", prioridad: "no_circula" },
  ]);

  // El checklist manda "no puede circular" solo en los puntos en Mal
  const plantilla = [{ id: "luces", nombre: "Luces", puntos: [{ id: "altas", nombre: "Altas" }, { id: "bajas", nombre: "Bajas" }] }];
  const r = itemsChecklist({ plantilla, secciones: ["luces"], respuestas: { "luces.altas": { estado: "mal", no_circula: true }, "luces.bajas": { estado: "bien", no_circula: true } } });
  assert.deepEqual(r.map((i) => i.no_circula), [true, undefined]);
});

test("alertas: un arreglo 🔴 pone el vehículo en rojo y va primero; uno 🟡 en amarillo", () => {
  const v = { id: 7, patente: "AB123CD", km: 1000 };
  const arreglos = [
    { id: 1, vehiculo_id: 7, descripcion: "Freno de mano", prioridad: "no_circula", estado: "pendiente" },
    { id: 2, vehiculo_id: 7, descripcion: "Espejo", prioridad: "pronto", estado: "pendiente" },
    { id: 3, vehiculo_id: 7, descripcion: "Ya está", prioridad: "no_circula", estado: "resuelto" },
    { id: 4, vehiculo_id: 8, descripcion: "De otro", prioridad: "no_circula", estado: "pendiente" },
  ];
  assert.deepEqual(alertasArreglos(7, arreglos).map((a) => [a.clave, a.nivel]), [["arr-1", "vencido"], ["arr-2", "pronto"]]);
  const al = alertasVehiculo(v, { arreglos, hoy: HOY });
  assert.equal(peorNivel(al), "vencido");
  assert.equal(textoAlerta(urgentes(al)[0], textoVencimiento), "🔧 Freno de mano (no puede circular)");
  assert.equal(textoAlerta(al.find((a) => a.clave === "arr-2"), textoVencimiento), "🔧 Espejo");
});

test("ultimoService, historial y costos por mes", () => {
  assert.equal(ultimoService([]), null);
  assert.deepEqual(ultimoService([
    { tipo: "service", fecha: "2026-03-01", km: 5000 },
    { tipo: "reparacion", fecha: "2026-09-01", km: 9000 },
    { tipo: "service", fecha: "2026-08-10", km: 8000 },
  ]), { fecha: "2026-08-10", km: 8000 });

  const h = historialVehiculo({
    checklists: [{ id: 1, created_at: "2026-10-20T13:00:00Z", mal: 1, revisar: 0, km: 1500, empleado_nombre: "Juan" }],
    arreglos: [{ id: 5, created_at: "2026-10-20T13:00:01Z", descripcion: "Altas: Quemada", prioridad: "pronto", estado: "descartado", cerrado_at: "2026-10-21T13:00:00Z", motivo: "Era el fusible" }],
    mantenimientos: [{ id: 9, tipo: "service", fecha: "2026-10-22", km: 1600, donde: "taller", taller: "Lubricentro Sur", detalle: "Aceite y filtros", costo: 85000, created_at: "2026-10-22T15:00:00Z" }],
    papeles: [{ id: 2, tipo: "seguro", created_at: "2026-01-05T12:00:00Z", vencimiento: "2027-01-05" }],
    nombrePapel: () => "Seguro",
  });
  assert.deepEqual(h.map((e) => e.texto), [
    "Service: Aceite y filtros", "Arreglo descartado: Altas: Quemada", "Arreglo anotado: Altas: Quemada", "Checklist", "Papel cargado: Seguro",
  ]);
  assert.match(h[0].detalle, /Lubricentro Sur · 1\.600 km · \$\s?85\.000/);
  assert.match(h[3].detalle, /❌ 1 mal · Juan · 1\.500 km/);

  assert.deepEqual(ultimosMeses("2026-02-15", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(nombreMes("2026-10"), "oct");
  const meses = ultimosMeses(HOY, 3); // ago, sep, oct
  const c = costosFlota({
    vehiculos: [{ id: 7, patente: "AB123CD" }, { id: 8, patente: "AA999ZZ" }],
    mantenimientos: [
      { vehiculo_id: 7, fecha: "2026-09-05", costo: 1000, km: 12000 },
      { vehiculo_id: 7, fecha: "2026-10-01", costo: "500.50", km: null },
      { vehiculo_id: 7, fecha: "2026-06-01", costo: 99999, km: 10000 }, // fuera del período: no suma, pero da los km de antes
      { vehiculo_id: 8, fecha: "2026-10-02", costo: null },
    ],
    checklists: [{ vehiculo_id: 7, created_at: "2026-10-20T13:00:00Z", km: 13500 }],
    meses,
  });
  assert.deepEqual(c.filas.map((f) => [f.vehiculo.patente, f.porMes["2026-09"], f.porMes["2026-10"], f.total, f.km]), [
    ["AB123CD", 1000, 500.5, 1500.5, 3500], ["AA999ZZ", 0, 0, 0, null],
  ]);
  assert.equal(c.total, 1500.5);
});

test("validación, migración 129 y lectura por /api/data", () => {
  const ok = flotaBody.safeParse({ accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "service", fecha: "2026-10-01", km: 1000, donde: "taller", taller: "Sur", detalle: "Aceite", costo: 85000 });
  assert.equal(ok.success, true);
  assert.deepEqual([ok.data.arreglo_id, ok.data.fotos, ok.data.factura_url], [null, [], null]);
  assert.equal(flotaBody.safeParse({ accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "service", fecha: "2026-10-01", detalle: "" }).success, false, "sin qué se hizo");
  assert.equal(flotaBody.safeParse({ accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "lavado", fecha: "2026-10-01", detalle: "x" }).success, false);
  assert.equal(flotaBody.safeParse({ accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "service", fecha: "2026-10-01", detalle: "x", costo: -1 }).success, false);
  assert.equal(flotaBody.safeParse({ accion: "arreglo_crear", vehiculo_id: 7, descripcion: "Espejo", prioridad: "urgente" }).success, false);
  assert.equal(flotaBody.safeParse({ accion: "arreglo_descartar", id: 1, motivo: " " }).success, false, "descartar pide el motivo");

  const sql = readFileSync(new URL("../supabase/migrations/129_arreglos_flota.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.vehiculo_mantenimientos/);
  assert.match(sql, /create table if not exists public\.vehiculo_arreglos/);
  assert.match(sql, /grant select, insert, update on public\.vehiculo_arreglos to authenticated/, "un arreglo no se borra: se descarta");
  assert.match(sql, /do \$mig\$/);

  assert.equal(autorizar("vehiculo_arreglos", "GET", { rol: "operativo" }).ok, true, "el chofer ve los de su vehículo");
  assert.equal(autorizar("vehiculo_mantenimientos", "GET", { rol: "operativo" }).ok, false, "los costos, solo gestión");
  assert.equal(autorizar("vehiculo_mantenimientos", "GET", { rol: "administrativo" }).ok, true);
  assert.equal(autorizar("vehiculo_arreglos", "POST", { rol: "gerencial" }).ok, false, "se escribe por /api/flota");
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /TABLAS_FLOTA = \[[^\]]*"vehiculo_arreglos", "vehiculo_mantenimientos"\]/);
});

// ─── Ruta ───

function mockRuta({ arreglo = { id: 5, vehiculo_id: 7, estado: "pendiente", responsable_id: CHOFER, descripcion: "Espejo" }, services = [], sin129 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=nombre"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.endsWith("&select=id"), respond: (u) => ({ status: 200, body: [CHOFER, OTRO].filter((id) => u.includes(id)).map((id) => ({ id })) }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/vehiculo_arreglos"),
      respond: (u, o) => {
        if (sin129) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.vehiculo_arreglos' in the schema cache" } };
        if (!o.method || o.method === "GET") return { status: 200, body: arreglo ? [arreglo] : [] };
        const body = anotar("vehiculo_arreglos", u, o);
        return { status: 201, body: [{ id: 50, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculo_mantenimientos"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("tipo=eq.service") ? services : [{ id: 9, vehiculo_id: 7, tipo: "service" }] };
        const body = anotar("vehiculo_mantenimientos", u, o);
        if (o.method === "DELETE") return { status: 204, body: null };
        return { status: 201, body: [{ id: 60, ...body }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/vehiculo_checklists"), respond: () => ({ status: 200, body: [{ id: 3 }] }) },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: [{ id: 7, km: 1000, responsable_id: CHOFER }] };
        anotar("vehiculos", u, o);
        return { status: 200, body: [{ id: 7 }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "administrativo", empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 9, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/flota", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/flota arreglos — anotar desde un checklist, cambiar prioridad, descartar; sin la 129 avisa", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), { accion: "arreglo_crear", vehiculo_id: 7, checklist_id: 3, seccion_nombre: "Fluidos", punto_nombre: "Aceite", descripcion: "Aceite: bajo", prioridad: "pronto" }));
  assert.equal(res.status, 200);
  const a = escrito.find((x) => x.tabla === "vehiculo_arreglos").body;
  assert.deepEqual([a.empresa_id, a.vehiculo_id, a.checklist_id, a.prioridad, a.responsable_id, a.creado_por], [E, 7, 3, "pronto", CHOFER, EMP], "sin responsable, el del vehículo");

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "arreglo_editar", id: 5, prioridad: "no_circula", responsable_id: OTRO }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].body, { prioridad: "no_circula", responsable_id: OTRO });

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "arreglo_descartar", id: 5, motivo: "Era el fusible" }));
  assert.equal(res.status, 200);
  assert.deepEqual([escrito[0].body.estado, escrito[0].body.motivo, escrito[0].body.cerrado_por], ["descartado", "Era el fusible", EMP]);

  mockRuta({ arreglo: { id: 5, vehiculo_id: 7, estado: "resuelto" } });
  assert.equal((await api.POST(req(await token(), { accion: "arreglo_descartar", id: 5, motivo: "x" }))).status, 409, "ya cerrado");

  mockRuta();
  assert.equal((await api.POST(req(await token("operativo", CHOFER), { accion: "arreglo_crear", vehiculo_id: 7, descripcion: "x", prioridad: "pronto" }))).status, 403);

  mockRuta({ sin129: true });
  res = await api.POST(req(await token(), { accion: "arreglo_crear", vehiculo_id: 7, descripcion: "Espejo", prioridad: "pronto" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 129/);
});

test("/api/flota mantenimiento_crear — service pone al día la alerta; resolver un arreglo; borrar lo reabre", async () => {
  let escrito = mockRuta({ services: [{ tipo: "service", fecha: "2026-10-01", km: 1200 }] });
  let res = await api.POST(req(await token(), { accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "service", fecha: "2026-10-01", km: 1200, donde: "taller", taller: "Sur", detalle: "Aceite y filtros", costo: 85000 }));
  assert.equal(res.status, 200);
  const m = escrito.find((x) => x.tabla === "vehiculo_mantenimientos").body;
  assert.deepEqual([m.tipo, m.km, m.costo, m.cargado_nombre], ["service", 1200, 85000, "Ana"]);
  const patches = escrito.filter((x) => x.tabla === "vehiculos").map((x) => x.body);
  assert.ok(patches.some((b) => b.km === 1200), "sube los km");
  assert.ok(patches.some((b) => b.service_fecha === "2026-10-01" && b.service_km === 1200), "pone al día el service");

  // Fecha futura no
  mockRuta();
  res = await api.POST(req(await token(), { accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "reparacion", fecha: "2099-01-01", detalle: "x" }));
  assert.equal(res.status, 400);

  // El responsable del arreglo lo resuelve; queda como "arreglo"
  escrito = mockRuta();
  res = await api.POST(req(await token("operativo", CHOFER), { accion: "mantenimiento_crear", vehiculo_id: 7, arreglo_id: 5, tipo: "reparacion", fecha: "2026-10-20", donde: "interno", detalle: "Cambié el espejo", costo: 12000 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "vehiculo_mantenimientos").body.tipo, "arreglo");
  const cerrado = escrito.find((x) => x.tabla === "vehiculo_arreglos").body;
  assert.deepEqual([cerrado.estado, cerrado.mantenimiento_id, cerrado.cerrado_por], ["resuelto", 60, CHOFER]);

  // Otro operario no, ni carga services sueltos
  mockRuta();
  assert.equal((await api.POST(req(await token("operativo", OTRO), { accion: "mantenimiento_crear", vehiculo_id: 7, arreglo_id: 5, tipo: "reparacion", fecha: "2026-10-20", detalle: "x" }))).status, 403);
  mockRuta();
  assert.equal((await api.POST(req(await token("operativo", CHOFER), { accion: "mantenimiento_crear", vehiculo_id: 7, tipo: "service", fecha: "2026-10-20", detalle: "x" }))).status, 403);

  // Borrar un service: el arreglo vuelve a pendiente y el service se recalcula
  escrito = mockRuta({ services: [{ tipo: "service", fecha: "2026-03-01", km: 500 }] });
  res = await api.POST(req(await token(), { accion: "mantenimiento_borrar", id: 9 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "vehiculo_arreglos").body.estado, "pendiente");
  assert.ok(escrito.some((x) => x.tabla === "vehiculo_mantenimientos" && x.metodo === "DELETE"));
  assert.deepEqual(escrito.find((x) => x.tabla === "vehiculos").body, { service_fecha: "2026-03-01", service_km: 500 });
});

// ─── Pantalla ───

const VEH = { id: 7, patente: "AB123CD", tipo: "camioneta", km: 1000, responsable_id: CHOFER, activo: true };
const EMPLEADOS = [{ id: CHOFER, nombre: "Juan Pérez" }, { id: OTRO, nombre: "Ana Gómez" }];

test("Ficha — 🔴 no puede circular arriba; resolver un arreglo; historial", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    enviados.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  let cambios = 0;
  render(<FichaVehiculo vehiculo={VEH} papeles={[]} empleados={EMPLEADOS} divisiones={[]} editable hoy={HOY} onVolver={() => {}} onCambio={async () => { cambios++; }}
    checklists={[{ id: 3, vehiculo_id: 7, created_at: "2026-10-20T13:00:00Z", km: 1000, mal: 1, revisar: 0, secciones: ["neumaticos"], items: [] }]}
    arreglos={[
      { id: 5, vehiculo_id: 7, checklist_id: 3, descripcion: "Delantera izquierda: Lisa", prioridad: "no_circula", estado: "pendiente", responsable_id: CHOFER, created_at: "2026-10-20T13:00:01Z" },
      { id: 6, vehiculo_id: 7, descripcion: "Espejo", prioridad: "pronto", estado: "pendiente", created_at: "2026-10-21T13:00:01Z" },
    ]}
    mantenimientos={[{ id: 9, vehiculo_id: 7, tipo: "reparacion", fecha: "2026-10-21", detalle: "Batería nueva", costo: 120000, created_at: "2026-10-21T15:00:00Z" }]} />);

  assert.match(screen.getByText(/No puede circular:/).textContent, /Delantera izquierda: Lisa/);
  const lista = screen.getByRole("list", { name: "Arreglos pendientes" });
  assert.match(lista.querySelectorAll("li")[0].textContent, /🔴 Delantera izquierda.*a cargo de Juan Pérez/);
  const hist = screen.getByRole("list", { name: "Historial" });
  assert.match(hist.textContent, /Reparación: Batería nueva/);
  assert.match(hist.textContent, /Checklist/);

  fireEvent.click(screen.getAllByText("✔ Resolver")[0]);
  fireEvent.change(screen.getByLabelText("Taller"), { target: { value: "Gomería Sur" } });
  fireEvent.change(screen.getByLabelText("Costo total ($)"), { target: { value: "45.000,50" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  const b = enviados[0];
  assert.deepEqual([b.accion, b.arreglo_id, b.tipo, b.taller, b.costo, b.detalle, b.fecha], ["mantenimiento_crear", 5, "arreglo", "Gomería Sur", 45000.5, "Delantera izquierda: Lisa", hoyArg()]);
  await waitFor(() => assert.equal(cambios, 1));
});

test("Flota — 💲 Costos por vehículo y mes", async () => {
  const hoy = hoyArg();
  global.fetch = async (url, opts = {}) => {
    const path = (opts.body ? JSON.parse(opts.body) : {}).path || "";
    const data = path.startsWith("vehiculo_mantenimientos") ? [{ id: 1, vehiculo_id: 7, tipo: "service", fecha: hoy, costo: 85000, km: 1000 }]
      : path.startsWith("vehiculos") ? [VEH]
        : path.startsWith("empleados") ? EMPLEADOS : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  await screen.findByRole("list", { name: "Vehículos" });
  fireEvent.click(screen.getByText("💲 Costos"));
  const tabla = screen.getByRole("table", { name: "Costos de la flota" });
  assert.match(tabla.textContent, /AB123CD.*85\.000/);
  cleanup();

  // Operativo no ve los costos
  render(<FlotaScreen empresaId={E} usuario={{ rol: "operativo" }} />);
  await screen.findByRole("list", { name: "Vehículos" });
  assert.equal(screen.queryByText("💲 Costos"), null);
});
