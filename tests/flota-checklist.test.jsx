// tests/flota-checklist.test.jsx — Mantenimiento, parte 29 (ítem 43,
// migración 127): el checklist de mantenimiento de un vehículo. Lo hace el
// chofer responsable (o la oficina, de cualquiera), completo o por secciones;
// Revisar y Mal piden nota y foto; la plantilla la edita cada empresa.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  PLANTILLA_FABRICA, contarEstados, estadoSugerido, faltantesChecklist, htmlChecklist, idNuevo, itemsChecklist, plantillaDe, resumenChecklist,
} from "../app/lib/checklistVehiculo.js";
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
const { default: ChecklistVehiculo } = await import("../app/components/ChecklistVehiculo.jsx");
const { default: PlantillaChecklist } = await import("../app/components/PlantillaChecklist.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const CHOFER = "33333333-3333-3333-3333-333333333333";
const OTRO = "44444444-4444-4444-4444-444444444444";
const MINI = [
  { id: "luces", nombre: "Luces", emoji: "💡", puntos: [{ id: "bajas", nombre: "Bajas" }, { id: "altas", nombre: "Altas" }] },
  { id: "neumaticos", nombre: "Neumáticos", emoji: "🛞", puntos: [{ id: "di", nombre: "Delantera izquierda: dibujo", valor: "mm", minimo: 1.6 }] },
];

// ─── Reglas ───

test("plantilla de fábrica: las siete secciones y la ITV de Córdoba", () => {
  assert.deepEqual(PLANTILLA_FABRICA.map((s) => s.nombre), ["Limpieza", "Fluidos", "Documentación", "Neumáticos", "ITV (requisitos)", "Seguro", "Luces"]);
  const itv = PLANTILLA_FABRICA.find((s) => s.id === "itv").puntos.map((p) => p.nombre).join(" | ");
  assert.match(itv, /Matafuego.*2 balizas.*Chaleco.*Botiquín/);
  for (const s of PLANTILLA_FABRICA) assert.equal(new Set(s.puntos.map((p) => p.id)).size, s.puntos.length, `ids únicos en ${s.nombre}`);
  assert.ok(flotaBody.safeParse({ accion: "checklist_plantilla_guardar", checklist: PLANTILLA_FABRICA }).success, "la de fábrica pasa la validación");

  assert.equal(plantillaDe(null), PLANTILLA_FABRICA);
  assert.equal(plantillaDe({ checklist: [] }), PLANTILLA_FABRICA);
  assert.equal(plantillaDe({ checklist: MINI }), MINI);
  assert.equal(idNuevo("Presión de ruedas", []), "presion_de_ruedas");
  assert.equal(idNuevo("Punto", ["punto", "punto_2"]), "punto_3");

  assert.equal(estadoSugerido({ minimo: 1.6 }, "1,2"), "mal");
  assert.equal(estadoSugerido({ minimo: 1.6 }, "3"), "bien");
  assert.equal(estadoSugerido({ minimo: null }, "3"), null);
});

test("qué falta, lo que se guarda, el resumen y el PDF", () => {
  const respuestas = {
    "luces.bajas": { estado: "bien" },
    "luces.altas": { estado: "mal", nota: "Quemada" },
  };
  let faltan = faltantesChecklist({ plantilla: MINI, secciones: ["luces"], respuestas, km: "" });
  assert.deepEqual(faltan, ["Los kilómetros", "Luces: Altas (falta la foto)"]);
  faltan = faltantesChecklist({ plantilla: MINI, secciones: ["luces", "neumaticos"], respuestas: { ...respuestas, "luces.altas": { estado: "mal", nota: "Quemada", foto: "https://x.test/f.jpg" } }, km: 1000 });
  assert.deepEqual(faltan, ["Neumáticos: Delantera izquierda: dibujo"]);

  const items = itemsChecklist({ plantilla: MINI, secciones: ["luces", "neumaticos"], respuestas: { ...respuestas, "neumaticos.di": { estado: "revisar", valor: "2,1", nota: "Gastada", foto: "https://x.test/r.jpg" } } });
  assert.deepEqual(items[1], { seccion: "luces", seccion_nombre: "Luces", punto: "altas", nombre: "Altas", estado: "mal", valor: null, unidad: null, nota: "Quemada", foto: null });
  assert.deepEqual([items[2].valor, items[2].unidad], ["2,1", "mm"]);
  assert.deepEqual(contarEstados(items), { revisar: 1, mal: 1 });
  assert.equal(resumenChecklist({ revisar: 1, mal: 1 }), "⚠️ 1 a revisar · ❌ 1 mal");
  assert.equal(resumenChecklist({ revisar: 0, mal: 0 }), "✅ Todo bien");

  const html = htmlChecklist({ empresa: "GI Group", vehiculo: { patente: "AB123CD", marca: "Toyota" }, checklist: { items, km: 85000, empleado_nombre: "Juan <b>", created_at: "2026-10-22T15:00:00Z", revisar: 1, mal: 1, firma_url: "javascript:alert(1)" } });
  assert.match(html, /<h1>Checklist de mantenimiento<\/h1>/);
  assert.match(html, /AB123CD Toyota/);
  assert.match(html, /85\.000/);
  assert.match(html, /Altas<div class="nota">Quemada<\/div>/);
  assert.match(html, /Juan &lt;b&gt;/);
  assert.doesNotMatch(html, /javascript:/, "solo imágenes https");
});

test("validación, migración 127 y lectura por /api/data", () => {
  const ok = (b) => flotaBody.safeParse(b).success;
  const item = { seccion: "luces", seccion_nombre: "Luces", punto: "bajas", nombre: "Bajas", estado: "bien" };
  assert.equal(ok({ accion: "checklist_crear", vehiculo_id: 7, km: 1000, secciones: ["luces"], items: [item] }), true);
  assert.equal(ok({ accion: "checklist_crear", vehiculo_id: 7, secciones: ["luces"], items: [item] }), false, "km obligatorio");
  assert.equal(ok({ accion: "checklist_crear", vehiculo_id: 7, km: 1000, secciones: ["luces"], items: [{ ...item, estado: "regular" }] }), false);
  assert.equal(ok({ accion: "checklist_crear", vehiculo_id: 7, km: 1000, combustible: "medio", secciones: ["luces"], items: [item] }), false);
  assert.equal(ok({ accion: "checklist_plantilla_guardar", checklist: null }), true, "volver a la de fábrica");
  assert.equal(ok({ accion: "checklist_plantilla_guardar", checklist: [{ id: "Luces!", nombre: "Luces", puntos: [{ id: "a", nombre: "A" }] }] }), false);

  const sql = readFileSync(new URL("../supabase/migrations/127_checklist_vehiculos.sql", import.meta.url), "utf8");
  assert.match(sql, /^do \$mig\$/m);
  assert.match(sql, /create table if not exists public\.flota_config/);
  assert.match(sql, /create table if not exists public\.vehiculo_checklists/);
  assert.match(sql, /grant select, insert on public\.vehiculo_checklists to authenticated/, "un checklist hecho no se cambia");
  assert.equal((sql.match(/enable row level security/g) || []).length, 2);

  assert.equal(autorizar("vehiculo_checklists", "GET", { rol: "operativo" }).ok, true);
  assert.equal(autorizar("vehiculo_checklists", "POST", { rol: "gerencial" }).ok, false, "se escribe por /api/flota");
  assert.equal(autorizar("flota_config", "GET", { rol: "operativo" }).ok, true);
  const data = readFileSync(new URL("../app/api/data/route.js", import.meta.url), "utf8");
  assert.match(data, /TABLAS_FLOTA = \["vehiculos", "vehiculo_papeles", "vehiculo_checklists", "flota_config"/);
});

// ─── Ruta ───

function mockRuta({ vehiculo = { id: 7, km: 1000, responsable_id: CHOFER, activo: true }, config = [{ checklist: MINI }], configExiste = true, sin127 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=nombre"), respond: () => ({ status: 200, body: [{ nombre: "Juan Pérez" }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/flota_config"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: config };
        const body = anotar("flota_config", u, o);
        if (o.method === "PATCH") return { status: 200, body: configExiste ? [body] : [] };
        return { status: 201, body: [body] };
      },
    },
    {
      // Parte 31 (129): lo que queda Mal pasa a arreglos
      match: (u) => u.includes("/rest/v1/vehiculo_arreglos"),
      respond: (u, o) => { anotar("vehiculo_arreglos", u, o); return { status: 201, body: [] }; },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculo_checklists"),
      respond: (u, o) => {
        if (sin127) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.vehiculo_checklists' in the schema cache" } };
        const body = anotar("vehiculo_checklists", u, o);
        return { status: 201, body: [{ id: 1, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/vehiculos"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: vehiculo ? [vehiculo] : [] };
        const body = anotar("vehiculos", u, o);
        return { status: 200, body: [{ ...vehiculo, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "operativo", empleadoId = CHOFER) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 9, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/flota", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const ITEMS = [
  { seccion: "luces", seccion_nombre: "Luces", punto: "bajas", nombre: "Bajas", estado: "bien" },
  { seccion: "luces", seccion_nombre: "Luces", punto: "altas", nombre: "Altas", estado: "mal", nota: "Quemada", foto: "https://x.test/f.jpg" },
];
const CHK = { accion: "checklist_crear", vehiculo_id: 7, km: 1500, combustible: "1/2", secciones: ["luces"], items: ITEMS };

test("/api/flota checklist_crear — el chofer de su vehículo; cuenta lo mal y sube los km", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), CHK));
  assert.equal(res.status, 200);
  const c = escrito.find((x) => x.tabla === "vehiculo_checklists").body;
  assert.deepEqual([c.empresa_id, c.vehiculo_id, c.empleado_id, c.empleado_nombre, c.km, c.combustible, c.revisar, c.mal], [E, 7, CHOFER, "Juan Pérez", 1500, "1/2", 0, 1]);
  const v = escrito.find((x) => x.tabla === "vehiculos");
  assert.equal(v.body.km, 1500);
  // Parte 31: lo que quedó Mal pasa a arreglos, a cargo del responsable
  const arr = escrito.find((x) => x.tabla === "vehiculo_arreglos").body;
  assert.deepEqual(arr.map((a) => [a.descripcion, a.prioridad, a.checklist_id, a.responsable_id]), [["Altas: Quemada", "pronto", 1, CHOFER]]);
  assert.ok(v.body.km_at);

  // La oficina puede hacerlo de cualquier vehículo
  mockRuta({ vehiculo: { id: 7, km: 1000, responsable_id: OTRO, activo: true } });
  assert.equal((await api.POST(req(await token("administrativo"), CHK))).status, 200);

  // Otro operario no
  mockRuta({ vehiculo: { id: 7, km: 1000, responsable_id: OTRO, activo: true } });
  assert.equal((await api.POST(req(await token(), CHK))).status, 403);

  // Los km no bajan
  mockRuta();
  res = await api.POST(req(await token(), { ...CHK, km: 900 }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /tenía 1\.000 km/);

  // Falta un punto de la sección, o la foto de uno en Mal
  mockRuta();
  res = await api.POST(req(await token(), { ...CHK, items: [ITEMS[0]] }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Falta marcar Luces: Altas/);
  mockRuta();
  res = await api.POST(req(await token(), { ...CHK, items: [ITEMS[0], { ...ITEMS[1], foto: null }] }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /necesita nota y foto/);

  // Sin plantilla propia usa la de fábrica: "luces" de fábrica tiene más puntos
  mockRuta({ config: [] });
  assert.equal((await api.POST(req(await token(), CHK))).status, 400);

  // Los mismos km no tocan el vehículo
  escrito = mockRuta();
  assert.equal((await api.POST(req(await token(), { ...CHK, km: 1000 }))).status, 200);
  assert.equal(escrito.some((x) => x.tabla === "vehiculos"), false);

  mockRuta({ sin127: true });
  res = await api.POST(req(await token(), CHK));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 127/);
});

test("/api/flota checklist_plantilla_guardar — solo la oficina; crea o actualiza; sin códigos repetidos", async () => {
  let escrito = mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "checklist_plantilla_guardar", checklist: MINI }))).status, 403);

  escrito = mockRuta();
  let res = await api.POST(req(await token("gerencial"), { accion: "checklist_plantilla_guardar", checklist: MINI }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito.map((x) => x.metodo), ["PATCH"]);

  escrito = mockRuta({ configExiste: false });
  res = await api.POST(req(await token("gerencial"), { accion: "checklist_plantilla_guardar", checklist: null }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito.map((x) => x.metodo), ["PATCH", "POST"]);
  assert.deepEqual([escrito[1].body.empresa_id, escrito[1].body.checklist], [E, null]);

  mockRuta();
  res = await api.POST(req(await token("gerencial"), { accion: "checklist_plantilla_guardar", checklist: [MINI[0], { ...MINI[1], id: "luces" }] }));
  assert.equal(res.status, 400);
});

// ─── Pantalla ───

function mockPantalla({ config = [{ checklist: MINI }], sin127 = false } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/flota")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, checklist: { id: 1, ...body, revisar: 0, mal: 1, created_at: "2026-10-22T15:00:00Z" } }), { status: 200 });
    }
    if (String(url).includes("/api/upload")) return new Response(JSON.stringify({ url: "https://x.test/subida.jpg" }), { status: 200 });
    const path = body?.path || "";
    if (sin127 && path.startsWith("flota_config")) {
      return new Response(JSON.stringify({ error: 'La tabla "flota_config" no existe todavía en la base' }), { status: 409 });
    }
    return new Response(JSON.stringify({ data: path.startsWith("flota_config") ? config : [] }), { status: 200 });
  };
  return enviados;
}

const VEH = { id: 7, patente: "AB123CD", marca: "Toyota", km: 1000 };

test("Checklist — todo bien, una luz mal con nota, el dibujo bajo el mínimo marca Mal; sin foto no guarda", async () => {
  const enviados = mockPantalla();
  render(<ChecklistVehiculo vehiculos={[VEH]} onClose={() => {}} />);
  const luces = await screen.findByRole("region", { name: "Luces" });
  fireEvent.click(screen.getByText("Guardar checklist"));
  assert.match(screen.getByRole("alert").textContent, /Los kilómetros.*Luces: Bajas/);

  fireEvent.change(screen.getByLabelText("Kilómetros"), { target: { value: "1.500" } });
  fireEvent.click(within(luces).getByText("✅ Todo bien"));
  fireEvent.click(within(within(luces).getByRole("group", { name: "Estado de Altas" })).getByText(/Mal/));
  fireEvent.change(screen.getByLabelText("Nota de Altas"), { target: { value: "Quemada" } });

  // 1,2 mm: debajo de 1,6 queda en Mal y pide nota y foto
  fireEvent.change(screen.getByLabelText("Delantera izquierda: dibujo (mm)"), { target: { value: "1,2" } });
  assert.equal(within(screen.getByRole("group", { name: "Estado de Delantera izquierda: dibujo" })).getByText(/Mal/).closest("button").getAttribute("aria-pressed"), "true");

  // Solo Luces: se saca Neumáticos
  fireEvent.click(within(screen.getByRole("group", { name: "Secciones" })).getByText(/Neumáticos/));
  fireEvent.click(screen.getByText("Guardar checklist"));
  assert.match(screen.getByRole("alert").textContent, /Luces: Altas \(falta la foto\)/);
  assert.equal(enviados.length, 0);
});

test("Checklist — guarda solo las secciones elegidas; el chofer con dos vehículos elige", async () => {
  let enviados = mockPantalla();
  render(<ChecklistVehiculo vehiculos={[VEH]} onClose={() => {}} />);
  await screen.findByRole("region", { name: "Luces" });
  fireEvent.change(screen.getByLabelText("Kilómetros"), { target: { value: "1500" } });
  fireEvent.click(within(screen.getByRole("group", { name: "Secciones" })).getByText(/Neumáticos/));
  fireEvent.click(within(screen.getByRole("region", { name: "Luces" })).getByText("✅ Todo bien"));
  fireEvent.click(within(screen.getByRole("group", { name: "Combustible" })).getByText("1/2"));
  fireEvent.click(screen.getByText("Guardar checklist"));
  await waitFor(() => assert.equal(enviados.length, 1));
  const b = enviados[0];
  assert.deepEqual([b.accion, b.vehiculo_id, b.km, b.combustible, b.secciones, b.items.length], ["checklist_crear", 7, 1500, "1/2", ["luces"], 2]);
  assert.ok(b.items.every((i) => i.estado === "bien"));
  assert.equal(b.firma_url, null, "sin firmar no sube nada");
  await screen.findByText("Checklist guardado");
  cleanup();

  mockPantalla();
  render(<ChecklistVehiculo vehiculos={[VEH, { id: 8, patente: "AA999ZZ" }]} onClose={() => {}} />);
  fireEvent.click(screen.getByText(/AA999ZZ/));
  await screen.findByRole("region", { name: "Luces" });
  cleanup();

  enviados = mockPantalla({ sin127: true });
  render(<ChecklistVehiculo vehiculos={[VEH]} onClose={() => {}} />);
  assert.match((await screen.findByRole("alert")).textContent, /migración 127/);
});

test("Plantilla — agregar un punto, guardar y volver a la de fábrica", async () => {
  const enviados = mockPantalla();
  render(<PlantillaChecklist />);
  const luces = await screen.findByRole("region", { name: "Luces" });
  fireEvent.click(within(luces).getByText("＋ Punto"));
  fireEvent.click(screen.getByText("Guardar"));
  assert.match(screen.getByRole("alert").textContent, /Completá los nombres de "Luces"/);
  fireEvent.change(within(luces).getByLabelText("Punto 3 de Luces"), { target: { value: "Antiniebla" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "checklist_plantilla_guardar");
  assert.deepEqual(enviados[0].checklist[0].puntos.map((p) => p.nombre), ["Bajas", "Altas", "Antiniebla"]);
  assert.equal(enviados[0].checklist[1].puntos[0].minimo, 1.6);

  fireEvent.click(screen.getByText("Volver al de fábrica"));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.equal(enviados[1].checklist, null);
  await screen.findByRole("region", { name: "Limpieza" });
});
