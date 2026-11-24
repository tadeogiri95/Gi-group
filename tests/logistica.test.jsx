// tests/logistica.test.jsx — Logística, parte 1 (migración 203; pedido de
// Tadeo, 23/11): módulo propio, libreta de Lugares con dirección y pin, y la
// dirección de la obra de las OT (una vez por obra, queda en todas sus OT).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { TIPOS_LUGAR, claveObra, obrasDeOts, puedeGestionarLogistica, textoUbicacion, tipoLugar } from "../app/lib/logistica.js";
import { coordsValidas, linkGoogleMaps, parseMapsInput, decodePlusCode } from "../app/lib/ubicacion.js";
import { logisticaBody } from "../app/lib/schemas.ts";
import { autorizar } from "../app/lib/dataPolicy.js";
import { modulosEfectivos, MODULOS, INCLUIDOS_CON } from "../app/lib/modulos.js";
import { opcionesBoton, conBoton } from "../app/lib/menuGestion.js";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/logistica/route.js");
const { default: LogisticaScreen } = await import("../app/components/LogisticaScreen.jsx");
const { getItems } = await import("../app/components/nav/BottomNav.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// ─── Reglas ───

test("módulo — Logística viene con las OT, se apaga aparte y tiene su botón en la barra", () => {
  assert.equal(MODULOS.logistica.disponible, true);
  assert.ok(INCLUIDOS_CON.proyectos.includes("logistica"));
  const planta = { modulos: modulosEfectivos({ plan: "planta_15" }) };
  assert.ok(planta.modulos.includes("logistica"));
  assert.equal(conBoton("logistica", planta), true);
  assert.deepEqual(opcionesBoton("logistica", planta, { rol: "gerencial" }).map((o) => o.id), ["log-lugares"]);
  assert.deepEqual(getItems("gerencial", 0, planta.modulos).map((i) => i.label), ["Inicio", "Producción", "Materiales", "Mantenimiento", "Logística", "Finanzas", "Más"]);
  // Apagada en Más → Módulos: sin botón
  const apagada = { modulos: planta.modulos.filter((m) => m !== "logistica"), modulos_apagados: ["logistica"] };
  assert.equal(conBoton("logistica", apagada), false);
  assert.ok(!getItems("gerencial", 0, apagada.modulos).some((i) => i.id === "logistica"));
  // El operario no tiene el botón (su vista llega con Mis viajes)
  assert.ok(!getItems("operativo", 0, planta.modulos).some((i) => i.id === "logistica"));
  // La migración sigue el patrón: un solo bloque, RLS por empresa y en la lista del chequeo de la base
  const sql = readFileSync(new URL("../supabase/migrations/203_logistica_lugares.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /\('logistica', 'Logística', '[^']+', true, 69\)/);
  assert.match(sql, /enable row level security/);
  assert.ok(MIGRACIONES.some((m) => m.n === 203 && m.tablas.logistica_lugares && m.tablas.proyectos.includes("direccion")));
  assert.equal(autorizar("logistica_lugares", "GET", { rol: "operativo" }).ok, true, "el chofer va a ver los lugares (Mis viajes)");
  assert.equal(autorizar("logistica_lugares", "POST", { rol: "gerencial" }).ok, false, "se escribe por /api/logistica");
});

test("ubicación — link de Google Maps con el pin o con la dirección; lee links, coordenadas y Plus Code", () => {
  assert.equal(linkGoogleMaps({ lat: -34.45, lng: -58.91 }), "https://www.google.com/maps/search/?api=1&query=-34.45,-58.91");
  assert.equal(linkGoogleMaps({ direccion: "Ruta 8 km 50, Pilar" }), "https://www.google.com/maps/search/?api=1&query=Ruta%208%20km%2050%2C%20Pilar");
  // El pin manda sobre la dirección
  assert.match(linkGoogleMaps({ lat: -34.45, lng: -58.91, direccion: "x" }), /query=-34.45,-58.91$/);
  assert.equal(linkGoogleMaps({}), null);
  assert.equal(coordsValidas(null, null), false);
  assert.equal(coordsValidas(0, 0), false, "0,0 es un pin vacío");
  assert.equal(coordsValidas(-91, 0), false);
  assert.equal(coordsValidas("-34.5", "-58.4"), true);
  assert.deepEqual(parseMapsInput("https://www.google.com/maps/place/Planta/@-34.4567,-58.9123,17z"), { lat: -34.4567, lng: -58.9123 });
  assert.deepEqual(parseMapsInput("-34.6, -58.4"), { lat: -34.6, lng: -58.4 });
  assert.ok(decodePlusCode("48Q3CJ8M+XX"));
  assert.equal(textoUbicacion({ direccion: " Calle 1 " }), "Calle 1");
  assert.equal(textoUbicacion({ lat: -34.6, lng: -58.4 }), "Solo pin en el mapa");
  assert.equal(textoUbicacion({}), "Sin dirección");
  assert.equal(tipoLugar("deposito").label, "Depósito");
  assert.equal(tipoLugar("nada").id, "otro");
  assert.equal(TIPOS_LUGAR.length, 5);
  assert.equal(puedeGestionarLogistica("gerencial"), true);
  assert.equal(puedeGestionarLogistica("administrativo"), true);
  assert.equal(puedeGestionarLogistica("operativo"), false);
});

test("obras — una por nombre de obra (sin obra, el cliente), sin dirección primero; las cerradas no van", () => {
  const ps = [
    { id: 1, ot: "7450", obra: "Torre Norte", cliente: "Pérez", estado: "activo", lat: -34.5, lng: -58.5, direccion: "Av. Libertador 100" },
    { id: 2, ot: "7451", obra: " torre  norte ", cliente: "Pérez", estado: "activo" },
    { id: 3, ot: "7460", obra: "", cliente: "Gómez", estado: "activo" },
    { id: 4, ot: "7300", obra: "Vieja", estado: "cerrado" },
    { id: 5, ot: "7470", obra: "Casa Sur", cliente: "Casa Sur", estado: "activo", direccion: "San Martín 50" },
  ];
  assert.equal(claveObra(ps[0]), claveObra(ps[1]), "mismo nombre aunque cambien espacios o mayúsculas");
  assert.equal(claveObra(ps[2]), "cliente:gómez");
  assert.equal(claveObra({ ot: "1" }), "ot:1");
  const obras = obrasDeOts(ps);
  assert.deepEqual(obras.map((o) => o.nombre), ["Gómez", "Torre Norte", "Casa Sur"]);
  const torre = obras.find((o) => o.nombre === "Torre Norte");
  assert.deepEqual(torre.ots, ["7450", "7451"]);
  assert.deepEqual(torre.ids, [1, 2]);
  assert.equal(torre.conPin, true);
  assert.equal(torre.direccion, "Av. Libertador 100");
  assert.equal(torre.sinDireccion, 1, "una OT de la obra todavía sin dirección");
  assert.equal(torre.cliente, "Pérez");
  const casa = obras.find((o) => o.nombre === "Casa Sur");
  assert.equal(casa.cliente, "", "no repite el cliente si se llama igual que la obra");
  assert.equal(casa.conPin, false);
  assert.equal(obrasDeOts([{ id: 1, ot: "1", obra: "A", lat: -34, lng: -58 }, { id: 2, ot: "2", obra: "A", lat: -35, lng: -58 }])[0].distintas, true);
});

test("validación — lugar con nombre y tipo; el pin va completo; la obra lleva sus OT", () => {
  assert.ok(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "Planta", tipo: "planta", lat: -34.5, lng: -58.9 }).success);
  assert.ok(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "Depósito", tipo: "deposito", direccion: "Calle 1" }).success);
  assert.equal(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "X", tipo: "planta", lat: -34.5 }).success, false, "pin a medias");
  assert.equal(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "", tipo: "planta" }).success, false);
  assert.equal(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "X", tipo: "obra" }).success, false, "las obras salen de las OT");
  assert.equal(logisticaBody.safeParse({ accion: "lugar_guardar", nombre: "X", tipo: "planta", lat: 100, lng: 0 }).success, false);
  assert.ok(logisticaBody.safeParse({ accion: "lugar_baja", id: 3, activo: false }).success);
  assert.ok(logisticaBody.safeParse({ accion: "obra_direccion", ot_ids: [1, 2], direccion: "Calle 1", lat: null, lng: null }).success);
  assert.equal(logisticaBody.safeParse({ accion: "obra_direccion", ot_ids: [], direccion: "Calle 1" }).success, false);
});

// ─── /api/logistica ───

function mockRuta({ sin203 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method, url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: (u) => ({ status: 200, body: u.includes("id=eq.8&") ? [{ id: 8 }] : [] }) },
    {
      match: (u) => u.includes("/rest/v1/logistica_lugares"),
      respond: (u, o) => {
        if (sin203) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.logistica_lugares' in the schema cache" } };
        const body = anotar("logistica_lugares", u, o);
        if (o.method === "PATCH" && u.includes("id=eq.99&")) return { status: 200, body: [] };
        return { status: 201, body: [{ id: 3, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/proyectos"),
      respond: (u, o) => {
        const body = anotar("proyectos", u, o);
        return { status: 200, body: [{ id: 1, ...body }, { id: 2, ...body }] };
      },
    },
  ]);
  return escrito;
}

async function token(rol = "administrativo") {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = (t, body) => new Request("http://localhost/api/logistica", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/logistica lugar_guardar y lugar_baja — alta, edición, proveedor de la empresa, permisos y migración", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token(), { accion: "lugar_guardar", nombre: "Planta Pilar", tipo: "planta", direccion: "Ruta 8 km 50", lat: -34.45, lng: -58.91, proveedor_id: 8 }));
  assert.equal(res.status, 200);
  const alta = escrito.find((x) => x.tabla === "logistica_lugares");
  assert.equal(alta.metodo, "POST");
  assert.equal(alta.body.empresa_id, E);
  assert.equal(alta.body.proveedor_id, null, "solo un proveedor lleva proveedor");
  assert.equal(alta.body.lat, -34.45);

  escrito = mockRuta();
  res = await api.POST(req(await token(), { accion: "lugar_guardar", id: 3, nombre: "Maderera", tipo: "proveedor", direccion: "Calle 2", proveedor_id: 8 }));
  assert.equal(res.status, 200);
  const edit = escrito.find((x) => x.tabla === "logistica_lugares");
  assert.equal(edit.metodo, "PATCH");
  assert.match(edit.url, new RegExp(`id=eq.3&empresa_id=eq.${E}`));
  assert.equal(edit.body.proveedor_id, 8);
  // Un proveedor de otra empresa no se liga
  mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "lugar_guardar", nombre: "X", tipo: "proveedor", proveedor_id: 9 }))).status, 404);
  // Un lugar que no es de la empresa
  mockRuta();
  assert.equal((await api.POST(req(await token(), { accion: "lugar_baja", id: 99, activo: false }))).status, 404);
  escrito = mockRuta();
  assert.equal((await api.POST(req(await token("gerencial"), { accion: "lugar_baja", id: 3, activo: false }))).status, 200);
  assert.equal(escrito[0].body.activo, false);
  // El operario no carga lugares
  mockRuta();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "lugar_baja", id: 3, activo: false }))).status, 403);
  // Sin la 203
  mockRuta({ sin203: true });
  res = await api.POST(req(await token(), { accion: "lugar_guardar", nombre: "Planta", tipo: "planta", direccion: "x" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 203/);
  // Sin sesión
  assert.equal((await api.POST(new Request("http://localhost/api/logistica", { method: "POST", body: "{}" }))).status, 401);
});

test("/api/logistica obra_direccion — la dirección queda en todas las OT elegidas, solo de la empresa", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token(), { accion: "obra_direccion", ot_ids: [1, 2, 2], direccion: "Av. Libertador 100", lat: -34.5, lng: -58.5 }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ots, 2);
  const p = escrito.find((x) => x.tabla === "proyectos");
  assert.equal(p.metodo, "PATCH");
  assert.match(p.url, new RegExp(`id=in.\\(1,2\\)&empresa_id=eq.${E}`));
  assert.deepEqual(p.body, { direccion: "Av. Libertador 100", lat: -34.5, lng: -58.5 });
});

// ─── Pantalla ───

const LUGARES = [
  { id: 1, nombre: "Planta Pilar", tipo: "planta", direccion: "Ruta 8 km 50", lat: -34.45, lng: -58.91, activo: true },
  { id: 2, nombre: "Maderera López", tipo: "proveedor", direccion: "Calle 2", lat: null, lng: null, contacto: "Juan", activo: true },
  { id: 3, nombre: "Depósito viejo", tipo: "deposito", direccion: "Calle 3", activo: false },
];
const PROYECTOS = [
  { id: 10, ot: "7450", obra: "Torre Norte", cliente: "Pérez", estado: "activo", direccion: null, lat: null, lng: null },
  { id: 11, ot: "7451", obra: "Torre Norte", cliente: "Pérez", estado: "activo", direccion: null, lat: null, lng: null },
];

function mockPantalla() {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/logistica")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, lugar: { id: 9 } }), { status: 200 });
    }
    const path = body?.path || String(url);
    const data = path.includes("logistica_lugares") ? LUGARES : path.includes("proyectos") ? PROYECTOS : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  return enviados;
}

test("pantalla — lugares con su link a Maps, alta de un lugar y dirección de una obra para todas sus OT", async () => {
  const enviados = mockPantalla();
  render(<LogisticaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  const lista = await screen.findByRole("list", { name: "Lugares" });
  assert.match(lista.textContent, /Planta Pilar/);
  assert.match(lista.textContent, /Maderera López/);
  assert.match(lista.textContent, /sin pin/, "con dirección pero sin pin");
  assert.doesNotMatch(lista.textContent, /Depósito viejo/, "los dados de baja no se ven");
  assert.equal(screen.getByRole("link", { name: "Abrir Planta Pilar en Google Maps" }).getAttribute("href"), "https://www.google.com/maps/search/?api=1&query=-34.45,-58.91");

  fireEvent.click(screen.getByRole("button", { name: "＋ Agregar lugar" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  assert.match(screen.getByRole("alert").textContent, /nombre/);
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Depósito Escobar" } });
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "deposito" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  assert.match(screen.getByRole("alert").textContent, /dirección/);
  fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Colectora 123, Escobar" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].nombre, enviados[0].tipo, enviados[0].direccion, enviados[0].lat], ["lugar_guardar", "Depósito Escobar", "deposito", "Colectora 123, Escobar", null]);

  await screen.findByRole("list", { name: "Lugares" });
  fireEvent.click(screen.getByRole("button", { name: /Obras/ }));
  assert.match(screen.getByRole("button", { name: /Obras/ }).textContent, /1 sin dirección/);
  const obras = screen.getByRole("list", { name: "Obras" });
  assert.match(obras.textContent, /Torre Norte/);
  assert.match(obras.textContent, /OT 7450, 7451/);
  fireEvent.click(screen.getByRole("button", { name: "Dirección de Torre Norte" }));
  assert.ok(screen.getByText(/queda en las 2 OT de esta obra/));
  fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "https://maps.google.com/?q=-34.5,-58.5" } });
  fireEvent.click(screen.getByRole("button", { name: "🔍 Buscar" }));
  await waitFor(() => assert.ok(screen.getByText(/mover el pin/)));
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual(enviados[1], { accion: "obra_direccion", ot_ids: [10, 11], direccion: null, lat: -34.5, lng: -58.5 });
});

test("pantalla — sin la migración avisa; un operario mira pero no carga", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: 'La tabla "logistica_lugares" no existe todavía en la base' }), { status: 409 });
  render(<LogisticaScreen empresaId={E} usuario={{ rol: "gerencial" }} />);
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /migración 203/));
  cleanup();
  mockPantalla();
  render(<LogisticaScreen empresaId={E} usuario={{ rol: "operativo" }} />);
  await screen.findByRole("list", { name: "Lugares" });
  assert.equal(screen.queryByRole("button", { name: "＋ Agregar lugar" }), null);
  assert.ok(screen.getByRole("button", { name: "Planta Pilar" }).disabled);
});
