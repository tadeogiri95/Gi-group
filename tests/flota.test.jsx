// tests/flota.test.jsx — Mantenimiento, parte 28 (ítem 43, migración 126):
// la flota de vehículos con su responsable y sus papeles con vencimiento.
// Semáforo por vehículo (🔴 vencido, 🟡 vence pronto, ✅ al día); renovar un
// papel agrega uno nuevo y el anterior queda como historial.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  avisosVehiculo, estadoVencimiento, normalizarPatente, papelesVigentes, peorNivel, textoVencimiento, vencimientoPapel, puedeEditarFlota,
} from "../app/lib/flota.js";
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
const { default: FlotaScreen } = await import("../app/components/FlotaScreen.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CHOFER = "33333333-3333-3333-3333-333333333333";
const HOY = "2026-10-22";

// ─── Reglas ───

test("patente, vencimientos y semáforo", () => {
  assert.equal(normalizarPatente(" ab 123-cd "), "AB123CD");

  assert.deepEqual(estadoVencimiento("2026-10-20", 15, HOY), { nivel: "vencido", dias: -2 });
  assert.deepEqual(estadoVencimiento("2026-10-30", 15, HOY), { nivel: "pronto", dias: 8 });
  assert.deepEqual(estadoVencimiento("2026-12-30", 15, HOY), { nivel: "ok", dias: 69 });
  assert.equal(estadoVencimiento(null, 15, HOY).nivel, "sin_fecha");
  assert.equal(textoVencimiento({ nivel: "vencido", dias: -1 }), "Venció hace 1 día");
  assert.equal(textoVencimiento({ nivel: "pronto", dias: 0 }), "Vence hoy");
  assert.equal(textoVencimiento({ nivel: "pronto", dias: 8 }), "Vence en 8 días");
  assert.equal(textoVencimiento({ nivel: "ok", dias: 69 }, "2026-12-30"), "Vence el 30/12/2026");

  // ITV condicional: 60 días desde la revisión; rechazada: 30
  assert.equal(vencimientoPapel({ tipo: "itv", resultado: "condicional", fecha: "2026-10-01", vencimiento: "2027-10-01" }), "2026-11-30");
  assert.equal(vencimientoPapel({ tipo: "itv", resultado: "rechazado", fecha: "2026-10-01", vencimiento: null }), "2026-10-31");
  assert.equal(vencimientoPapel({ tipo: "itv", resultado: "apto", fecha: "2026-10-01", vencimiento: "2027-10-01" }), "2027-10-01");
  assert.equal(vencimientoPapel({ tipo: "seguro", fecha: "2026-10-01", vencimiento: "2026-11-01" }), "2026-11-01");

  // El vigente es el último cargado de cada tipo; "otro" va por nombre
  const papeles = [
    { id: 1, vehiculo_id: 7, tipo: "seguro", vencimiento: "2026-10-01", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, vehiculo_id: 7, tipo: "seguro", vencimiento: "2027-10-01", created_at: "2026-10-01T00:00:00Z" },
    { id: 3, vehiculo_id: 7, tipo: "otro", nombre: "RUTA", vencimiento: "2026-10-25", created_at: "2026-02-01T00:00:00Z" },
    { id: 4, vehiculo_id: 7, tipo: "otro", nombre: "Permiso municipal", vencimiento: null, created_at: "2026-02-01T00:00:00Z" },
    { id: 5, vehiculo_id: 8, tipo: "itv", vencimiento: "2026-01-01", created_at: "2026-02-01T00:00:00Z" },
  ];
  assert.deepEqual(papelesVigentes(papeles.filter((p) => p.vehiculo_id === 7)).map((p) => p.id), [2, 4, 3]);

  const avisos = avisosVehiculo({ id: 7 }, papeles, { nombre: "Juan", licencia_vencimiento: "2026-10-10" }, HOY);
  const por = Object.fromEntries(avisos.map((a) => [a.texto, a.nivel]));
  assert.equal(por.Seguro, "ok");
  assert.equal(por.RUTA, "pronto");
  assert.equal(por["Falta cargar la ITV"], "pronto");
  assert.equal(por["Licencia de Juan"], "vencido");
  assert.equal(peorNivel(avisos), "vencido");
  assert.equal(peorNivel([{ nivel: "sin_fecha" }]), "ok");

  // ITV rechazada: amarilla aunque falten más de 30 días para el plazo
  const rech = avisosVehiculo({ id: 9 }, [{ id: 9, vehiculo_id: 9, tipo: "itv", resultado: "rechazado", fecha: HOY, created_at: "x" }, { id: 10, vehiculo_id: 9, tipo: "seguro", vencimiento: "2027-01-01", created_at: "x" }], null, HOY);
  assert.equal(peorNivel(rech), "pronto");

  assert.equal(puedeEditarFlota("gerencial"), true);
  assert.equal(puedeEditarFlota("administrativo"), true);
  assert.equal(puedeEditarFlota("operativo"), false);
});

test("validación, migración 126 y lectura por /api/data", () => {
  const ok = (b) => flotaBody.safeParse(b).success;
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "camioneta", km: 120000, responsable_id: CHOFER }), true);
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "moto" }), false);
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", anio: 1800 }), false);
  assert.equal(ok({ accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", foto_url: "http://x.test/a.jpg" }), false, "fotos https");
  assert.equal(ok({ accion: "papel_guardar", vehiculo_id: 1, tipo: "itv", resultado: "condicional", fecha: "2026-10-01" }), true);
  assert.equal(ok({ accion: "papel_guardar", vehiculo_id: 1, tipo: "otro" }), false, "otro necesita nombre");
  assert.equal(ok({ accion: "papel_guardar", vehiculo_id: 1, tipo: "seguro", fotos: Array(5).fill("https://x.test/a.jpg") }), false, "hasta 4 fotos");
  assert.equal(ok({ accion: "licencia_guardar", empleado_id: CHOFER, categoria: "B1", vencimiento: "2027-05-01" }), true);
  assert.equal(ok({ accion: "vehiculo_baja", id: 1, activo: false }), true);

  const sql = readFileSync(new URL("../supabase/migrations/126_flota_vehiculos.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  assert.match(sql, /create table if not exists public\.vehiculos/);
  assert.match(sql, /create table if not exists public\.vehiculo_papeles/);
  assert.match(sql, /vehiculos \(empresa_id, upper\(patente\)\)/);
  assert.match(sql, /add column if not exists licencia_vencimiento date/);
  assert.equal((sql.match(/enable row level security/g) || []).length, 2);

  assert.equal(autorizar("vehiculos", "GET", { rol: "operativo" }).ok, true, "el chofer va a ver su vehículo (parte 29)");
  assert.equal(autorizar("vehiculo_papeles", "POST", { rol: "gerencial" }).ok, false, "se escribe por /api/flota");
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /\.\.\.TABLAS_COMPRAS, \.\.\.TABLAS_FLOTA, \.\.\.TABLAS_MAQUINARIA\]/, "solo lectura por /api/data");
  assert.match(data, /"vehiculos", "vehiculo_papeles", \/\/ Flota/);
});

// ─── Ruta ───

function mockRuta({ vehiculos = [{ id: 7, km: 1000 }], empleados = [{ id: CHOFER }], duplicada = false, sin126 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    {
      match: (u, o) => u.includes("/rest/v1/empleados") && o.method === "PATCH",
      respond: (u, o) => {
        const body = anotar("empleados", u, o);
        return { status: 200, body: u.includes(CHOFER) ? [{ id: CHOFER, ...body }] : [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.endsWith("&select=id"), respond: (u) => ({ status: 200, body: empleados.filter((e) => u.includes(e.id)) }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/vehiculo_papeles"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("id=eq.3&") ? [{ id: 3 }] : [] };
        const body = anotar("vehiculo_papeles", u, o);
        if (o.method === "DELETE") return { status: 204, body: null };
        return { status: 201, body: [{ id: 50, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (sin126) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.vehiculos' in the schema cache" } };
        if (!o.method || o.method === "GET") return { status: 200, body: vehiculos.filter((v) => u.includes(`id=eq.${v.id}&`)) };
        if (duplicada && o.method === "POST") return { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint \"vehiculos_empresa_patente\"" } };
        const body = anotar("vehiculos", u, o);
        if (o.method === "PATCH" && !vehiculos.some((v) => u.includes(`id=eq.${v.id}&`))) return { status: 200, body: [] };
        return { status: 201, body: [{ id: 7, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "administrativo") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/flota", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/flota vehiculo_guardar — alta con patente normalizada, edición y patente repetida", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "ab 123 cd", tipo: "camioneta", marca: "Toyota", km: 85000, responsable_id: CHOFER }));
  assert.equal(res.status, 200);
  const alta = escrito.find((x) => x.tabla === "vehiculos");
  assert.equal(alta.metodo, "POST");
  assert.deepEqual([alta.body.patente, alta.body.empresa_id, alta.body.responsable_id, alta.body.km], ["AB123CD", E, CHOFER, 85000]);
  assert.ok(alta.body.km_at, "anota cuándo se cargaron los km");

  escrito = mockRuta();
  res = await api.POST(req(await token("gerencial"), { accion: "vehiculo_guardar", id: 7, patente: "AB123CD", tipo: "camioneta", km: 1000 }));
  assert.equal(res.status, 200);
  const ed = escrito.find((x) => x.tabla === "vehiculos");
  assert.equal(ed.metodo, "PATCH");
  assert.match(ed.url, /id=eq\.7&empresa_id=eq\./);
  assert.equal("km_at" in ed.body, false, "los mismos km no cambian la fecha");

  mockRuta({ duplicada: true });
  res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ya hay un vehículo con la patente AB123CD/);

  mockRuta({ empleados: [] });
  res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto", responsable_id: CHOFER }));
  assert.equal(res.status, 404, "el responsable tiene que ser de la empresa");
});

test("/api/flota — papeles, licencia, baja, permisos y migración", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), {
    accion: "papel_guardar", vehiculo_id: 7, tipo: "seguro", compania: "La Segunda", cobertura: "Terceros completo",
    numero: "123", fecha: "2026-10-01", vencimiento: "2027-10-01", resultado: "apto", fotos: ["https://x.test/p.jpg"],
  }));
  assert.equal(res.status, 200);
  const p = escrito.find((x) => x.tabla === "vehiculo_papeles");
  assert.deepEqual([p.metodo, p.body.vehiculo_id, p.body.compania, p.body.resultado, p.body.cargado_por, p.body.fotos.length], ["POST", 7, "La Segunda", null, EMP, 1]);

  mockRuta();
  res = await api.POST(req(await token(), { accion: "papel_guardar", vehiculo_id: 7, tipo: "itv", fecha: "2026-10-10", vencimiento: "2026-10-01" }));
  assert.equal(res.status, 400);

  mockRuta({ vehiculos: [] });
  assert.equal((await api.POST(req(await token(), { accion: "papel_guardar", vehiculo_id: 7, tipo: "seguro" }))).status, 404);

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "papel_borrar", id: 3 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "vehiculo_papeles").metodo, "DELETE");

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "licencia_guardar", empleado_id: CHOFER, categoria: "B1", vencimiento: "2027-05-01" }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito.find((x) => x.tabla === "empleados").body, { licencia_categoria: "B1", licencia_vencimiento: "2027-05-01" });

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "vehiculo_baja", id: 7, activo: false }));
  assert.equal(res.status, 200);
  assert.equal(escrito.find((x) => x.tabla === "vehiculos").body.activo, false);

  mockRuta();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "vehiculo_baja", id: 7, activo: false }))).status, 403);

  mockRuta({ sin126: true });
  res = await api.POST(req(await token(), { accion: "vehiculo_guardar", patente: "AB123CD", tipo: "auto" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 126/);
});

// ─── Pantalla ───

const VEHICULOS = [
  { id: 7, patente: "AB123CD", tipo: "camioneta", marca: "Toyota", modelo: "Hilux", km: 85000, responsable_id: CHOFER, activo: true },
  { id: 8, patente: "AA999ZZ", tipo: "camion", marca: "Iveco", activo: true },
];
const PAPELES = [
  { id: 1, vehiculo_id: 7, tipo: "seguro", compania: "La Segunda", vencimiento: "2099-01-01", fotos: [], created_at: "2026-01-01T00:00:00Z" },
  { id: 2, vehiculo_id: 7, tipo: "itv", resultado: "apto", vencimiento: "2099-01-01", fotos: [], created_at: "2026-01-01T00:00:00Z" },
  { id: 3, vehiculo_id: 8, tipo: "seguro", vencimiento: "2020-01-01", fotos: [], created_at: "2026-01-01T00:00:00Z" },
];
const EMPLEADOS = [{ id: CHOFER, nombre: "Juan Pérez", licencia_categoria: "B1", licencia_vencimiento: "2099-01-01" }];

function mockPantalla({ sin126 = false } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/flota")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, vehiculo: { id: 9 } }), { status: 200 });
    }
    const path = body?.path || "";
    if (sin126 && path.startsWith("vehiculos")) {
      return new Response(JSON.stringify({ error: 'La tabla "vehiculos" no existe todavía en la base' }), { status: 409 });
    }
    const data = path.startsWith("vehiculo_papeles") ? PAPELES
      : path.startsWith("vehiculos") ? VEHICULOS
        : path.startsWith("empleados") ? EMPLEADOS : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("Flota — lista con semáforo, lo vencido arriba; ficha con papeles y renovar", async () => {
  const enviados = mockPantalla();
  render(<FlotaScreen empresaId={E} usuario={{ rol: "administrativo" }} />);
  const lista = await screen.findByRole("list", { name: "Vehículos" });
  const filas = lista.querySelectorAll("li");
  assert.match(filas[0].textContent, /🔴AA999ZZ/, "el vencido primero");
  assert.match(filas[0].textContent, /Seguro: venció hace/);
  assert.match(filas[0].textContent, /Falta cargar la ITV/);
  // Papeles al día, pero sin checklist ni service cargado: 🟡 (parte 30)
  assert.match(filas[1].textContent, /🟡AB123CD.*Juan Pérez.*Falta el primer checklist/);

  fireEvent.click(screen.getByLabelText("Ver AB123CD"));
  const papeles = await screen.findByRole("list", { name: "Papeles vigentes" });
  assert.match(papeles.textContent, /Seguro.*La Segunda/);
  assert.match(papeles.textContent, /ITV.*Apto/);
  assert.match(screen.getByText("Juan Pérez").parentElement.textContent, /categoría B1/);

  fireEvent.click(screen.getAllByText("Renovar")[0]);
  assert.equal(screen.getByLabelText("Compañía").value, "La Segunda", "renovar arranca con los datos del anterior");
  fireEvent.change(screen.getByLabelText("Vence"), { target: { value: "2028-01-01" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "papel_guardar");
  assert.equal(enviados[0].id, undefined, "renovar agrega uno nuevo");
  assert.deepEqual([enviados[0].vehiculo_id, enviados[0].tipo, enviados[0].compania, enviados[0].vencimiento], [7, "seguro", "La Segunda", "2028-01-01"]);
});

test("Flota — alta de vehículo, choferes y aviso de migración", async () => {
  let enviados = mockPantalla();
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  fireEvent.click(await screen.findByText("＋ Agregar vehículo"));
  fireEvent.change(screen.getByLabelText("Patente"), { target: { value: "ac 456 dd" } });
  fireEvent.change(screen.getByLabelText("Kilómetros"), { target: { value: "12.500" } });
  fireEvent.change(screen.getByLabelText("Chofer habitual"), { target: { value: CHOFER } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].patente, enviados[0].km, enviados[0].responsable_id], ["vehiculo_guardar", "ac 456 dd", 12500, CHOFER]);
  cleanup();

  mockPantalla();
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  await screen.findByRole("list", { name: "Vehículos" });
  fireEvent.click(screen.getByText("🪪 Choferes"));
  assert.match(screen.getByRole("list", { name: "Choferes" }).textContent, /Juan Pérez.*AB123CD.*Categoría B1/);
  cleanup();

  // Sin permiso de edición no hay botones de carga
  mockPantalla();
  render(<FlotaScreen empresaId={E} usuario={{ rol: "operativo" }} />);
  await screen.findByRole("list", { name: "Vehículos" });
  assert.equal(screen.queryByText("＋ Agregar vehículo"), null);
  cleanup();

  enviados = mockPantalla({ sin126: true });
  render(<FlotaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  assert.match((await screen.findByRole("alert")).textContent, /falta correr la migración 126/);
});
