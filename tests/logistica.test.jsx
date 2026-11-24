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
  assert.deepEqual(opcionesBoton("logistica", planta, { rol: "gerencial" }).map((o) => o.id), ["log-tablero", "log-viajes", "log-lugares"]);
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

// ─── Parte 2 (204): viajes ───

const { ordenarPorCercania, moverParada, linksRecorrido, kmEnLineaRecta, choquesDelDia, siguienteNumero, viajeEditable, accionPorTipo, MAX_INTERMEDIAS } = await import("../app/lib/logistica.js");
const { default: LogisticaViajes } = await import("../app/components/LogisticaViajes.jsx");

test("viajes — ordenar por cercanía desde la salida (sin pin al final), mover a mano y avisos del día", () => {
  const planta = { lat: -34.45, lng: -58.91 };
  const ps = [
    { nombre: "Lejos", lat: -34.6, lng: -58.4 },
    { nombre: "Sin pin", direccion: "Calle 1" },
    { nombre: "Cerca", lat: -34.46, lng: -58.9 },
    { nombre: "Medio", lat: -34.5, lng: -58.7 },
  ];
  const r = ordenarPorCercania(planta, ps);
  assert.deepEqual(r.paradas.map((p) => p.nombre), ["Cerca", "Medio", "Lejos", "Sin pin"]);
  assert.equal(r.sinPin, 1);
  // Sin salida con pin arranca por la primera con pin
  assert.equal(ordenarPorCercania(null, ps).paradas[0].nombre, "Lejos");
  assert.deepEqual(moverParada(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moverParada(["a", "b"], 0, -1), ["a", "b"], "la primera no sube");
  assert.ok(kmEnLineaRecta(planta, r.paradas, true) > kmEnLineaRecta(planta, r.paradas, false));
  assert.equal(siguienteNumero([{ numero: 3 }, { numero: 7 }]), 8);
  assert.equal(siguienteNumero([]), 1);
  assert.equal(viajeEditable({ estado: "planificado" }), true);
  assert.equal(viajeEditable({ estado: "en_camino" }), false);
  assert.equal(accionPorTipo("abastecimiento"), "retirar");
  assert.equal(accionPorTipo("distribucion"), "entregar");
  const otros = [{ id: 1, numero: 4, fecha: "2026-11-25", vehiculo_id: 7, chofer_id: "a", estado: "planificado" }, { id: 2, numero: 5, fecha: "2026-11-25", vehiculo_id: 7, estado: "cancelado" }];
  const c = choquesDelDia({ id: 9, fecha: "2026-11-25", vehiculo_id: 7, chofer_id: "b" }, otros);
  assert.deepEqual(c.vehiculo.map((v) => v.numero), [4], "el cancelado no cuenta");
  assert.deepEqual(c.chofer, []);
});

test("viajes — recorrido en Google Maps: sale, pasa en orden y vuelve; con más de 9 intermedias va en tramos", () => {
  const planta = { lat: -34.45, lng: -58.91 };
  const { tramos, sinUbicar } = linksRecorrido({ origen: planta, paradas: [{ lat: -34.5, lng: -58.7 }, { direccion: "San Martín 50, Tigre" }, { nombre: "nada" }], vuelve: true });
  assert.equal(sinUbicar, 1);
  assert.equal(tramos.length, 1);
  const u = new URL(tramos[0].url);
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/dir/");
  assert.equal(u.searchParams.get("api"), "1");
  assert.equal(u.searchParams.get("origin"), "-34.45,-58.91");
  assert.equal(u.searchParams.get("destination"), "-34.45,-58.91", "vuelve a la planta");
  assert.equal(u.searchParams.get("waypoints"), "-34.5,-58.7|San Martín 50, Tigre");
  assert.equal(u.searchParams.get("travelmode"), "driving");
  // Sin volver, termina en la última parada
  const ida = new URL(linksRecorrido({ origen: planta, paradas: [{ lat: -34.5, lng: -58.7 }, { lat: -34.6, lng: -58.4 }] }).tramos[0].url);
  assert.equal(ida.searchParams.get("destination"), "-34.6,-58.4");
  // 12 paradas + vuelta: 2 tramos, el segundo arranca donde terminó el primero
  const muchas = Array.from({ length: 12 }, (_, i) => ({ lat: -34 - i / 100, lng: -58 }));
  const t = linksRecorrido({ origen: planta, paradas: muchas, vuelve: true }).tramos;
  assert.equal(t.length, 2);
  for (const x of t) assert.ok((new URL(x.url).searchParams.get("waypoints") || "").split("|").length <= MAX_INTERMEDIAS);
  assert.equal(new URL(t[1].url).searchParams.get("origin"), new URL(t[0].url).searchParams.get("destination"));
  assert.deepEqual([t[0].desde, t[0].hasta, t[1].desde, t[1].hasta], [1, 10, 10, 12]);
  assert.deepEqual(linksRecorrido({ origen: null, paradas: [{ nombre: "x" }] }).tramos, []);
});

test("validación — viaje con fecha, hora y paradas (un lugar o las OT de una obra)", () => {
  const ok = { accion: "viaje_guardar", tipo: "distribucion", fecha: "2026-11-25", hora: "08:30", paradas: [{ lugar_id: 1 }, { ot_ids: [10, 11], accion: "entregar" }] };
  assert.ok(logisticaBody.safeParse(ok).success);
  assert.equal(logisticaBody.safeParse({ ...ok, paradas: [] }).success, false);
  assert.equal(logisticaBody.safeParse({ ...ok, paradas: [{ lugar_id: 1, ot_ids: [2] }] }).success, false, "o lugar u OT");
  assert.equal(logisticaBody.safeParse({ ...ok, paradas: [{}] }).success, false);
  assert.equal(logisticaBody.safeParse({ ...ok, hora: "25:00" }).success, false);
  assert.equal(logisticaBody.safeParse({ ...ok, fecha: "25/11/2026" }).success, false);
  assert.equal(logisticaBody.safeParse({ ...ok, tipo: "flete" }).success, false);
  assert.equal(logisticaBody.safeParse({ ...ok, paradas: Array.from({ length: 16 }, () => ({ lugar_id: 1 })) }).success, false);
  assert.ok(logisticaBody.safeParse({ accion: "viaje_cancelar", id: 3, motivo: "Llueve" }).success);
  assert.equal(logisticaBody.safeParse({ accion: "viaje_cancelar", id: 3, motivo: " " }).success, false);
  const sql = readFileSync(new URL("../supabase/migrations/204_logistica_viajes.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /logistica_viajes_numero_unico unique \(empresa_id, numero\)/);
  assert.ok(MIGRACIONES.some((m) => m.n === 204 && m.tablas.logistica_viajes && m.tablas.logistica_paradas));
  assert.equal(autorizar("logistica_viajes", "GET", { rol: "operativo" }).ok, true);
  assert.equal(autorizar("logistica_paradas", "DELETE", { rol: "gerencial" }).ok, false, "se escribe por /api/logistica");
});

function mockViajes({ viaje = null, ultimo = 6, sin204 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method || "GET", url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/vehiculos"), respond: (u) => ({ status: 200, body: u.includes("id=eq.7&") ? [{ id: 7 }] : [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: (u) => ({ status: 200, body: u.includes(EMP) ? [{ id: EMP }] : [] }) },
    {
      match: (u) => u.includes("/rest/v1/logistica_lugares"),
      respond: () => ({ status: 200, body: [{ id: 1, nombre: "Planta Pilar", direccion: "Ruta 8 km 50", lat: -34.45, lng: -58.91 }, { id: 2, nombre: "Maderera", direccion: "Calle 2", lat: null, lng: null }] }),
    },
    {
      match: (u) => u.includes("/rest/v1/proyectos"),
      respond: () => ({ status: 200, body: [
        { id: 10, ot: "7450", obra: "Torre Norte", cliente: "Pérez", estado: "activo", direccion: "Libertador 100", lat: -34.55, lng: -58.45 },
        { id: 11, ot: "7451", obra: "Torre Norte", cliente: "Pérez", estado: "cerrado", direccion: null, lat: null, lng: null },
      ] }),
    },
    {
      match: (u) => u.includes("/rest/v1/logistica_viajes"),
      respond: (u, o) => {
        if (sin204) return { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.logistica_viajes' in the schema cache" } };
        const body = anotar("logistica_viajes", u, o);
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("order=numero.desc") ? [{ numero: ultimo }] : (viaje ? [viaje] : []) };
        if (o.method === "PATCH" && viaje?.estado !== "planificado" && body.estado !== "cancelado") return { status: 200, body: [] };
        return { status: 201, body: [{ id: viaje?.id || 40, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/logistica_paradas"),
      respond: (u, o) => {
        const body = anotar("logistica_paradas", u, o);
        return o.method === "DELETE" ? { status: 204 } : { status: 201, body: Array.isArray(body) ? body : [] };
      },
    },
  ]);
  return escrito;
}

test("/api/logistica viaje_guardar — número correlativo, paradas con dirección copiada y vehículo/chofer de la empresa", async () => {
  let escrito = mockViajes();
  let res = await api.POST(req(await token(), {
    accion: "viaje_guardar", tipo: "distribucion", fecha: "2026-11-25", hora: "08:30", vehiculo_id: 7, chofer_id: EMP, origen_id: 1, vuelve: true,
    paradas: [{ ot_ids: [10, 11], accion: "entregar", notas: "Bultos 1 a 12" }, { lugar_id: 2, accion: "retirar" }],
  }));
  assert.equal(res.status, 200);
  const alta = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "POST");
  assert.equal(alta.body.numero, 7, "el siguiente al último");
  assert.equal(alta.body.estado, "planificado");
  assert.equal(alta.body.hora, "08:30");
  assert.equal(alta.body.empresa_id, E);
  const ps = escrito.find((x) => x.tabla === "logistica_paradas" && x.metodo === "POST").body;
  assert.equal(ps.length, 2);
  assert.deepEqual([ps[0].orden, ps[0].nombre, ps[0].cliente, ps[0].direccion, ps[0].lat, ps[0].viaje_id], [1, "Torre Norte", "Pérez", "Libertador 100", -34.55, 40]);
  assert.deepEqual(ps[0].ots, ["7450", "7451"], "también la OT cerrada");
  assert.equal(ps[0].notas, "Bultos 1 a 12");
  assert.deepEqual([ps[1].orden, ps[1].lugar_id, ps[1].nombre, ps[1].accion, ps[1].lat], [2, 2, "Maderera", "retirar", null]);

  // Editar uno planificado: reescribe las paradas
  escrito = mockViajes({ viaje: { id: 40, estado: "planificado" } });
  res = await api.POST(req(await token(), { accion: "viaje_guardar", id: 40, tipo: "interno", fecha: "2026-11-26", paradas: [{ lugar_id: 1 }] }));
  assert.equal(res.status, 200);
  assert.ok(escrito.some((x) => x.tabla === "logistica_paradas" && x.metodo === "DELETE" && x.url.includes("viaje_id=eq.40")));
  assert.ok(escrito.some((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH" && x.url.includes("estado=eq.planificado")));
  // Uno que ya salió no se cambia
  mockViajes({ viaje: { id: 40, estado: "en_camino" } });
  assert.equal((await api.POST(req(await token(), { accion: "viaje_guardar", id: 40, tipo: "interno", fecha: "2026-11-26", paradas: [{ lugar_id: 1 }] }))).status, 409);
  // Vehículo, chofer o lugar de otra empresa
  mockViajes();
  assert.equal((await api.POST(req(await token(), { accion: "viaje_guardar", tipo: "interno", fecha: "2026-11-26", vehiculo_id: 8, paradas: [{ lugar_id: 1 }] }))).status, 404);
  mockViajes();
  assert.equal((await api.POST(req(await token(), { accion: "viaje_guardar", tipo: "interno", fecha: "2026-11-26", chofer_id: "33333333-3333-3333-3333-333333333333", paradas: [{ lugar_id: 1 }] }))).status, 404);
  mockViajes();
  assert.equal((await api.POST(req(await token(), { accion: "viaje_guardar", tipo: "interno", fecha: "2026-11-26", paradas: [{ lugar_id: 99 }] }))).status, 404);
  // El operario no arma viajes; sin la 204 avisa
  mockViajes();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_guardar", tipo: "interno", fecha: "2026-11-26", paradas: [{ lugar_id: 1 }] }))).status, 403);
  mockViajes({ sin204: true });
  res = await api.POST(req(await token(), { accion: "viaje_guardar", tipo: "interno", fecha: "2026-11-26", paradas: [{ lugar_id: 1 }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 204/);
});

test("/api/logistica viaje_cancelar — con motivo, solo si no terminó", async () => {
  const escrito = mockViajes({ viaje: { id: 40, estado: "planificado" } });
  const res = await api.POST(req(await token(), { accion: "viaje_cancelar", id: 40, motivo: "Se pasó para mañana" }));
  assert.equal(res.status, 200);
  const c = escrito.find((x) => x.metodo === "PATCH");
  assert.match(c.url, /estado=in.\(planificado,en_camino\)/);
  assert.deepEqual([c.body.estado, c.body.motivo_cancelado], ["cancelado", "Se pasó para mañana"]);
});

function mockPantallaViajes() {
  const enviados = [];
  const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const D = {
    logistica_viajes: [{ id: 40, numero: 7, tipo: "distribucion", fecha: HOY, hora: "08:30:00", estado: "planificado", vehiculo_id: 7, chofer_id: EMP, origen_id: 1, vuelve: true }],
    logistica_paradas: [
      { id: 1, viaje_id: 40, orden: 1, nombre: "Torre Norte", ots: ["7450"], cliente: "Pérez", direccion: "Libertador 100", lat: -34.55, lng: -58.45, accion: "entregar" },
      { id: 2, viaje_id: 40, orden: 2, nombre: "Maderera López", ots: [], lugar_id: 3, direccion: "Calle 2", accion: "retirar" },
    ],
    logistica_lugares: [
      { id: 1, nombre: "Planta Pilar", tipo: "planta", lat: -34.45, lng: -58.91, activo: true },
      { id: 3, nombre: "Maderera López", tipo: "proveedor", direccion: "Calle 2", activo: true },
    ],
    proyectos: [
      { id: 10, ot: "7450", obra: "Torre Norte", cliente: "Pérez", estado: "activo", direccion: "Libertador 100", lat: -34.55, lng: -58.45 },
      { id: 12, ot: "7460", obra: "Casa Nordelta", cliente: "Gómez", estado: "activo", lat: -34.41, lng: -58.65 },
    ],
    vehiculos: [{ id: 7, patente: "AB123CD", marca: "Renault", modelo: "Master", responsable_id: EMP }],
    empleados: [{ id: EMP, nombre: "Carlos Chofer" }],
  };
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/logistica")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, viaje: { id: 41, fecha: body.fecha } }), { status: 200 });
    }
    const tabla = String(body?.path || url).split("?")[0];
    return new Response(JSON.stringify({ data: D[tabla] || [] }), { status: 200 });
  };
  return enviados;
}

test("pantalla de viajes — los del día con sus paradas, la ficha con el recorrido y armar uno nuevo", async () => {
  const enviados = mockPantallaViajes();
  render(<LogisticaViajes empresaId={E} usuario={{ rol: "gerencial" }} />);
  const lista = await screen.findByRole("list", { name: "Viajes del día" });
  assert.match(lista.textContent, /Viaje 7 · Entrega · 08:30/);
  assert.match(lista.textContent, /Torre Norte → Maderera López/);
  assert.match(lista.textContent, /Carlos Chofer · AB123CD · 2 paradas/);

  fireEvent.click(screen.getByRole("button", { name: "Ver viaje 7" }));
  const mapa = screen.getByRole("link", { name: /Ver recorrido en Google Maps/ });
  const u = new URL(mapa.getAttribute("href"));
  assert.equal(u.searchParams.get("origin"), "-34.45,-58.91");
  assert.equal(u.searchParams.get("waypoints"), "-34.55,-58.45|Calle 2");
  fireEvent.click(screen.getByRole("button", { name: "← Viajes" }));

  fireEvent.click(await screen.findByRole("button", { name: "＋ Armar viaje" }));
  assert.equal(screen.getByLabelText("Sale de").value, "1", "sale de la planta");
  fireEvent.change(screen.getByLabelText("Vehículo"), { target: { value: "7" } });
  assert.equal(screen.getByLabelText("Chofer").value, EMP, "el chofer habitual del vehículo");
  const choques = screen.getAllByText(/ya tiene el viaje 7/).map((x) => x.textContent).join(" ");
  assert.match(choques, /el vehículo ya tiene/);
  assert.match(choques, /el chofer ya tiene/);
  fireEvent.change(screen.getByLabelText("Buscar parada"), { target: { value: "Torre" } });
  fireEvent.click(screen.getByRole("button", { name: /Torre Norte/ }));
  fireEvent.click(screen.getByRole("button", { name: "＋ Agregar parada" }));
  fireEvent.click(screen.getByRole("button", { name: /Casa Nordelta/ }));
  // Casa Nordelta queda más cerca de la planta: ordenar la pone primero
  fireEvent.click(screen.getByRole("button", { name: "📍 Ordenar por cercanía" }));
  const orden = screen.getByRole("list", { name: "Paradas del viaje" });
  assert.match(orden.textContent, /Casa Nordelta[\s\S]*Torre Norte/);
  // Y a mano se puede volver a cambiar
  fireEvent.click(screen.getByRole("button", { name: "Subir Torre Norte" }));
  assert.match(orden.textContent, /Torre Norte[\s\S]*Casa Nordelta/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar viaje" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  const b = enviados[0];
  assert.deepEqual([b.accion, b.tipo, b.vehiculo_id, b.chofer_id, b.origen_id, b.vuelve], ["viaje_guardar", "distribucion", 7, EMP, 1, true]);
  assert.deepEqual(b.paradas.map((p) => [p.lugar_id, p.ot_ids, p.accion]), [[null, [10], "entregar"], [null, [12], "entregar"]]);
});

test("pantalla de viajes — sin la 204 avisa; el operario ve los viajes pero no arma", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: 'La tabla "logistica_viajes" no existe todavía en la base' }), { status: 409 });
  render(<LogisticaViajes empresaId={E} usuario={{ rol: "gerencial" }} />);
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /migración 204/));
  cleanup();
  mockPantallaViajes();
  render(<LogisticaViajes empresaId={E} usuario={{ rol: "operativo" }} />);
  await screen.findByRole("list", { name: "Viajes del día" });
  assert.equal(screen.queryByRole("button", { name: "＋ Armar viaje" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Ver viaje 7" }));
  assert.equal(screen.queryByRole("button", { name: "✏️ Cambiar el viaje" }), null);
});

// ─── Parte 3 (205): Mis viajes del chofer ───

const L3 = await import("../app/lib/logistica.js");
const { default: MisViajes } = await import("../app/components/MisViajes.jsx");
const SB = "https://test.supabase.co/storage/v1/object/public/reportes-obra";

test("mis viajes — renglones de bultos y sueltos, resultado según lo tildado y lo que falta para cumplir", () => {
  const r = L3.renglonesDeOts({
    ots: ["7450"],
    bultos: [{ id: 2, ot: "7450", numero: 2, contenido: "Bajo mesada" }, { id: 1, ot: "7450", numero: 1 }, { id: 9, ot: "9999", numero: 1 }],
    sueltos: [{ id: 5, ot: "7450", codigo: "BIS", descripcion: "Bisagra", medida: "35mm", cantidad: 12 }],
  });
  assert.deepEqual(r.map((x) => [x.origen, x.texto, x.cantidad, x.hecha]), [
    ["bulto", "OT 7450 · Bulto 1 de 2", 1, 1],
    ["bulto", "OT 7450 · Bulto 2 de 2 · Bajo mesada", 1, 1],
    ["suelto", "OT 7450 · BIS · Bisagra · 35mm", 12, 12],
  ]);
  assert.equal(L3.resultadoDeRenglones(r), "entregado");
  assert.equal(L3.resultadoDeRenglones(r.map((x, i) => (i === 2 ? { ...x, hecha: 8 } : x))), "parcial");
  assert.equal(L3.resultadoDeRenglones(r.map((x) => ({ ...x, hecha: 0 }))), "rechazado");
  assert.equal(L3.resultadoDeRenglones([]), null);

  const f = L3.faltaParaCumplir;
  assert.match(f({}), /Elegí cómo terminó/);
  assert.match(f({ estado: "entregado" }), /al menos una foto/);
  assert.match(f({ estado: "entregado", fotos: ["a"] }), /Falta la firma/);
  assert.equal(f({ estado: "entregado", fotos: ["a"], sin_firma: true }), null, "sin nadie para firmar");
  assert.equal(f({ estado: "entregado", fotos: ["a"], firma_url: "x" }), null);
  assert.equal(f({ estado: "entregado", accion: "retirar", fotos: ["a"] }), null, "en un retiro la firma es opcional");
  assert.match(f({ estado: "parcial", fotos: ["a"], firma_url: "x" }), /motivo/);
  assert.match(f({ estado: "rechazado", motivo: "golpeado" }), /foto/, "lo rechazado también lleva foto");
  assert.equal(f({ estado: "rechazado", motivo: "golpeado", fotos: ["a"] }), null, "lo rechazado no se firma");
  assert.match(f({ estado: "no_visitado" }), /por qué no se fue/);
  assert.equal(f({ estado: "no_visitado", motivo: "cerrado" }), null, "si no se fue, sin foto ni firma");
  assert.match(f({ estado: "entregado", fotos: ["1", "2", "3", "4", "5", "6"], sin_firma: true }), /Hasta 5/);
  assert.match(f({ estado: "parcial", motivo: "x", fotos: ["a"], sin_firma: true, renglones: r }), /bajá la cantidad/);
});

test("mis viajes — qué viajes ve el chofer, el texto del botón, el avance y quién lo puede cumplir", () => {
  const HOY = "2026-11-24";
  const vs = [
    { id: 1, numero: 1, estado: "terminado", fecha: "2026-11-23", chofer_id: EMP },
    { id: 2, numero: 2, estado: "planificado", fecha: HOY, hora: "14:00", chofer_id: EMP },
    { id: 3, numero: 3, estado: "en_camino", fecha: HOY, chofer_id: EMP },
    { id: 4, numero: 4, estado: "planificado", fecha: HOY, chofer_id: "otro" },
    { id: 5, numero: 5, estado: "cancelado", fecha: HOY, chofer_id: EMP },
    { id: 6, numero: 6, estado: "terminado", fecha: HOY, chofer_id: EMP },
    { id: 7, numero: 7, estado: "planificado", fecha: "2026-11-26", chofer_id: EMP },
  ];
  const mios = L3.misViajes(vs, EMP, HOY);
  assert.deepEqual(mios.map((v) => v.id), [3, 2, 7, 6], "primero el que está en camino; sin los de otro, cancelados ni terminados de otro día");
  assert.match(L3.detalleMisViajes(mios, HOY), /Viaje 3 en camino/);
  assert.equal(L3.detalleMisViajes(mios.filter((v) => v.id !== 3), HOY), "Tenés 1 viaje para hoy");
  assert.equal(L3.detalleMisViajes([vs[6]], HOY), "1 viaje armado para los próximos días");
  assert.deepEqual(L3.avanceViaje([{ estado: "entregado" }, { estado: "pendiente" }, { estado: "no_visitado" }]), { total: 3, hechas: 2, faltan: 1 });
  assert.equal(L3.puedeHacerViaje("operativo", { chofer_id: EMP }, EMP), true);
  assert.equal(L3.puedeHacerViaje("operativo", { chofer_id: "otro" }, EMP), false);
  assert.equal(L3.puedeHacerViaje("gerencial", { chofer_id: "otro" }, EMP), true, "el Dueño lo carga por el chofer");
  assert.equal(L3.estadoParada("entregado", "retirar").label, "Retirado");
  assert.equal(new URL(L3.linkComoLlegar({ lat: -34.55, lng: -58.45 })).searchParams.get("destination"), "-34.55,-58.45");
  assert.equal(L3.linkComoLlegar({}), null);
  // La migración: un bloque, columnas nuevas y en el chequeo de la base
  const sql = readFileSync(new URL("../supabase/migrations/205_logistica_mis_viajes.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists fotos text\[\]/);
  assert.match(sql, /cardinality\(fotos\) <= 5/);
  assert.ok(MIGRACIONES.some((m) => m.n === 205 && m.tablas.logistica_paradas.includes("firma_url")));
});

function mockMisViajes({ viaje = { id: 40, numero: 7, estado: "en_camino", chofer_id: EMP }, paradas = [], parada = { id: 1, viaje_id: 40, accion: "entregar" }, sin205 = false } = {}) {
  const escrito = [];
  const anotar = (tabla, u, o) => {
    const body = o.body ? JSON.parse(o.body) : null;
    escrito.push({ tabla, metodo: o.method || "GET", url: u, body });
    return body;
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/logistica_viajes"),
      respond: (u, o) => {
        const body = anotar("logistica_viajes", u, o);
        if (!o.method || o.method === "GET") return { status: 200, body: viaje ? [viaje] : [] };
        if (sin205) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'salida_at' column of 'logistica_viajes' in the schema cache" } };
        return { status: 200, body: [{ ...viaje, ...body }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/logistica_paradas"),
      respond: (u, o) => {
        const body = anotar("logistica_paradas", u, o);
        if (!o.method || o.method === "GET") return { status: 200, body: /[?&]id=eq\./.test(u) ? (parada ? [parada] : []) : paradas };
        if (sin205) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'renglones' column of 'logistica_paradas' in the schema cache" } };
        return { status: 200, body: [{ ...parada, ...body }] };
      },
    },
  ]);
  return escrito;
}

test("/api/logistica salir, cumplir y terminar — el chofer del viaje, con fotos de la app, y no termina con paradas pendientes", async () => {
  // Salir: el operario que es el chofer
  let escrito = mockMisViajes({ viaje: { id: 40, numero: 7, estado: "planificado", chofer_id: EMP } });
  let res = await api.POST(req(await token("operativo"), { accion: "viaje_salir", id: 40 }));
  assert.equal(res.status, 200);
  const salida = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH");
  assert.equal(salida.body.estado, "en_camino");
  assert.ok(salida.body.salida_at);
  assert.match(salida.url, /estado=eq.planificado/);
  // Otro operario no puede
  mockMisViajes({ viaje: { id: 40, numero: 7, estado: "planificado", chofer_id: "33333333-3333-3333-3333-333333333333" } });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_salir", id: 40 }))).status, 403);

  // Cumplir una entrega parcial con foto y firma
  escrito = mockMisViajes();
  const foto = `${SB}/${E}/foto1.jpg`;
  res = await api.POST(req(await token("operativo"), {
    accion: "parada_cumplir", id: 1, estado: "parcial", motivo: "Faltó un bulto",
    renglones: [{ origen: "bulto", ref: 1, ot: "7450", texto: "OT 7450 · Bulto 1 de 2", cantidad: 1, hecha: 1 }, { origen: "bulto", ref: 2, ot: "7450", texto: "OT 7450 · Bulto 2 de 2", cantidad: 1, hecha: 0 }],
    fotos: [foto], firma_url: `${SB}/${E}/firma.png`, firma_nombre: "Ana Pérez", firma_dni: "30111222", lat: -34.55, lng: -58.45,
  }));
  assert.equal(res.status, 200);
  const cumplida = escrito.find((x) => x.tabla === "logistica_paradas" && x.metodo === "PATCH").body;
  assert.deepEqual([cumplida.estado, cumplida.motivo, cumplida.fotos, cumplida.firma_nombre, cumplida.sin_firma, cumplida.hecha_por, cumplida.hecha_lat], ["parcial", "Faltó un bulto", [foto], "Ana Pérez", false, EMP, -34.55]);
  assert.equal(cumplida.renglones.length, 2);
  assert.ok(cumplida.hecha_at);

  // Una foto que no se subió desde la app, o sin foto: no
  mockMisViajes();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "entregado", fotos: ["https://otro.com/x.jpg"], sin_firma: true }))).status, 400);
  mockMisViajes();
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "entregado", sin_firma: true }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /foto/);
  // Si el viaje no había salido, sale al cumplir la primera parada
  escrito = mockMisViajes({ viaje: { id: 40, numero: 7, estado: "planificado", chofer_id: EMP } });
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "no_visitado", motivo: "Cerrado", fotos: [foto] }));
  assert.equal(res.status, 200);
  assert.ok(escrito.some((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH" && x.body.estado === "en_camino"));
  const noFue = escrito.find((x) => x.tabla === "logistica_paradas" && x.metodo === "PATCH").body;
  assert.deepEqual([noFue.estado, noFue.fotos, noFue.motivo], ["no_visitado", [], "Cerrado"], "si no se fue, sin fotos");
  // Un viaje terminado ya no se cambia
  mockMisViajes({ viaje: { id: 40, numero: 7, estado: "terminado", chofer_id: EMP } });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "no_visitado", motivo: "x" }))).status, 409);

  // Terminar: con una parada pendiente no; con todas cumplidas sí
  mockMisViajes({ paradas: [{ id: 1, estado: "entregado" }, { id: 2, estado: "pendiente" }] });
  res = await api.POST(req(await token("operativo"), { accion: "viaje_terminar", id: 40 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Falta 1 parada/);
  escrito = mockMisViajes({ paradas: [{ id: 1, estado: "entregado" }, { id: 2, estado: "no_visitado" }] });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_terminar", id: 40 }))).status, 200);
  const fin = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH");
  assert.deepEqual([fin.body.estado, !!fin.body.llegada_at], ["terminado", true]);

  // El operario sigue sin poder armar o cancelar; sin la 205 avisa
  mockMisViajes();
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_cancelar", id: 40, motivo: "x" }))).status, 403);
  mockMisViajes({ viaje: { id: 40, numero: 7, estado: "planificado", chofer_id: EMP }, sin205: true });
  res = await api.POST(req(await token("operativo"), { accion: "viaje_salir", id: 40 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 205/);
});

function mockPantallaChofer({ estadoViaje = "planificado", paradas = null } = {}) {
  const enviados = [];
  const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const D = {
    logistica_viajes: [{ id: 40, numero: 7, tipo: "distribucion", fecha: HOY, hora: "08:30:00", estado: estadoViaje, chofer_id: EMP, origen_id: 1, vuelve: true }],
    logistica_paradas: paradas || [
      { id: 1, viaje_id: 40, orden: 1, nombre: "Torre Norte", ots: ["7450"], cliente: "Pérez", direccion: "Libertador 100", lat: -34.55, lng: -58.45, accion: "entregar", estado: "pendiente", renglones: [], fotos: [] },
      { id: 2, viaje_id: 40, orden: 2, nombre: "Maderera López", ots: [], lugar_id: 3, direccion: "Calle 2", accion: "retirar", estado: "pendiente", renglones: [], fotos: [] },
    ],
    logistica_lugares: [
      { id: 1, nombre: "Planta Pilar", lat: -34.45, lng: -58.91 },
      { id: 3, nombre: "Maderera López", direccion: "Calle 2", telefono: "11 4444-5555", contacto: "Juan" },
    ],
    bultos_ot: [{ id: 1, ot: "7450", numero: 1, contenido: "Alacena" }, { id: 2, ot: "7450", numero: 2 }],
    sueltos_ot: [{ id: 5, ot: "7450", codigo: "BIS", descripcion: "Bisagra", cantidad: 12 }],
  };
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/upload")) return new Response(JSON.stringify({ url: `${SB}/${E}/foto.jpg` }), { status: 200 });
    if (String(url).includes("/api/logistica")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, parada: {}, viaje: {} }), { status: 200 });
    }
    const tabla = String(body?.path || url).split("?")[0];
    return new Response(JSON.stringify({ data: D[tabla] || [] }), { status: 200 });
  };
  return enviados;
}

test("pantalla Mis viajes — sale, cumple una parada con lo de la OT, foto y sin firma", async () => {
  const enviados = mockPantallaChofer();
  render(<MisViajes empleadoId={EMP} onClose={() => {}} />);
  const lista = await screen.findByRole("list", { name: "Mis viajes" });
  assert.match(lista.textContent, /Viaje 7 · Entrega/);
  assert.match(lista.textContent, /0 de 2 paradas/);
  fireEvent.click(screen.getByRole("button", { name: "Abrir viaje 7" }));
  assert.ok(screen.getByRole("link", { name: /Ver recorrido en Google Maps/ }));
  fireEvent.click(screen.getByRole("button", { name: "🚚 Salir" }));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "viaje_salir", id: 40 }));

  // La parada 1: bultos y sueltos de la OT, todos tildados
  fireEvent.click(screen.getByRole("button", { name: "Parada 1: Torre Norte" }));
  const rs = await screen.findByRole("list", { name: "Renglones" });
  assert.match(rs.textContent, /Bulto 1 de 2 · Alacena/);
  assert.match(rs.textContent, /BIS · Bisagra/);
  assert.match(screen.getByRole("link", { name: "🗺️ Cómo llegar" }).getAttribute("href"), /destination=-34.55%2C-58.45/);
  // Entregó 10 de 12 bisagras: queda parcial solo
  fireEvent.change(screen.getByLabelText("Cantidad de OT 7450 · BIS · Bisagra"), { target: { value: "10" } });
  assert.equal(screen.getByRole("button", { name: "🟠 Una parte" }).getAttribute("aria-pressed"), "true");
  // Sin motivo ni foto no deja guardar
  fireEvent.click(screen.getByRole("button", { name: "Guardar la parada" }));
  assert.match(screen.getByRole("alert").textContent, /motivo/);
  fireEvent.change(screen.getByLabelText("¿Qué pasó?"), { target: { value: "Faltaron 2 bisagras" } });
  // jsdom no carga imágenes: la foto va sin achicar
  const ImagenReal = global.Image;
  const LectorReal = global.FileReader;
  global.FileReader = window.FileReader;
  global.Image = class { set src(_v) { setTimeout(() => this.onerror?.(new Error("sin imágenes"))); } };
  const file = new window.File(["x"], "foto.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("Sacar foto"), { target: { files: [file] } });
  await screen.findByRole("button", { name: "Ver foto 1" });
  global.Image = ImagenReal;
  global.FileReader = LectorReal;
  fireEvent.click(screen.getByRole("checkbox", { name: /No hay nadie para firmar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar la parada" }));
  await waitFor(() => assert.equal(enviados.length, 2));
  const b = enviados[1];
  assert.deepEqual([b.accion, b.id, b.estado, b.motivo, b.sin_firma, b.firma_url], ["parada_cumplir", 1, "parcial", "Faltaron 2 bisagras", true, null]);
  assert.equal(b.fotos.length, 1);
  assert.deepEqual(b.renglones.map((r) => [r.origen, r.cantidad, r.hecha]), [["bulto", 1, 1], ["bulto", 1, 1], ["suelto", 12, 10]]);
});

test("pantalla Mis viajes — en camino con una pendiente no deja terminar; el retiro muestra el teléfono del lugar", async () => {
  mockPantallaChofer({
    estadoViaje: "en_camino",
    paradas: [
      { id: 1, viaje_id: 40, orden: 1, nombre: "Torre Norte", ots: ["7450"], accion: "entregar", estado: "entregado", renglones: [], fotos: [] },
      { id: 2, viaje_id: 40, orden: 2, nombre: "Maderera López", ots: [], lugar_id: 3, direccion: "Calle 2", accion: "retirar", estado: "pendiente", renglones: [], fotos: [] },
    ],
  });
  render(<MisViajes empleadoId={EMP} viajeId={40} onClose={() => {}} />);
  const term = await screen.findByRole("button", { name: "🏁 Terminar el viaje" });
  assert.equal(term.disabled, true);
  assert.match(screen.getByRole("list", { name: "Paradas del viaje" }).textContent, /👉 Sigue/);
  fireEvent.click(screen.getByRole("button", { name: "Parada 2: Maderera López" }));
  assert.equal((await screen.findByRole("link", { name: "📞 Llamar" })).getAttribute("href"), "tel:1144445555");
  assert.ok(screen.getByRole("button", { name: "✅ Retiré todo" }));
});

test("ficha del viaje — el Dueño ve cómo terminó cada parada (fotos, firma, motivo) y lo puede cargar por el chofer", async () => {
  const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const D = {
    logistica_viajes: [{ id: 40, numero: 7, tipo: "distribucion", fecha: HOY, estado: "en_camino", chofer_id: EMP, origen_id: 1, vuelve: true, salida_at: `${HOY}T11:00:00Z` }],
    logistica_paradas: [
      { id: 1, viaje_id: 40, orden: 1, nombre: "Torre Norte", ots: ["7450"], accion: "entregar", estado: "parcial", motivo: "Faltó un bulto", hecha_por: EMP, hecha_at: `${HOY}T12:30:00Z`,
        renglones: [{ origen: "bulto", texto: "Bulto 1", cantidad: 1, hecha: 1 }, { origen: "bulto", texto: "Bulto 2", cantidad: 1, hecha: 0 }],
        fotos: [`${SB}/${E}/a.jpg`], firma_url: `${SB}/${E}/f.png`, firma_nombre: "Ana Pérez", firma_dni: "30111222" },
      { id: 2, viaje_id: 40, orden: 2, nombre: "Casa Gómez", ots: [], accion: "entregar", estado: "pendiente" },
    ],
    empleados: [{ id: EMP, nombre: "Carlos Chofer" }],
  };
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    const tabla = String(body?.path || url).split("?")[0];
    return new Response(JSON.stringify({ data: D[tabla] || [] }), { status: 200 });
  };
  render(<LogisticaViajes empresaId={E} usuario={{ rol: "gerencial", id: "44444444-4444-4444-4444-444444444444" }} />);
  const lista = await screen.findByRole("list", { name: "Viajes del día" });
  assert.match(lista.textContent, /1 de 2 paradas/);
  fireEvent.click(screen.getByRole("button", { name: "Ver viaje 7" }));
  const ps = screen.getByRole("list", { name: "Paradas" });
  assert.match(ps.textContent, /🟠 Parcial/);
  assert.match(ps.textContent, /Carlos Chofer/);
  assert.match(ps.textContent, /Faltó un bulto/);
  assert.match(ps.textContent, /1 de 2 renglones completos\. Faltó: Bulto 2/);
  assert.match(ps.textContent, /Firmó Ana Pérez, DNI 30111222/);
  assert.ok(screen.getByRole("button", { name: "Ver foto 1 de Torre Norte" }));
  assert.ok(screen.getByRole("img", { name: "Firma de Ana Pérez" }));
  assert.ok(screen.getByRole("button", { name: "🚚 Cargar las paradas por el chofer" }));
});

// ─── Parte 4 (206): remito de cada parada ───

const remitoLib = await import("../app/lib/logisticaRemito.js");
const remitoSrv = await import("../app/lib/logisticaRemitoServidor.js");
const apiFirmar = await import("../app/api/remito/firmar/route.js");
const { default: RemitoParada } = await import("../app/components/RemitoParada.jsx");
const { default: RemitoPublico } = await import("../app/components/RemitoPublico.jsx");
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
// Un PNG chiquito de verdad (la firma tiene que ser una imagen)
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("remito — número con ceros, quién firma por link, mensaje para WhatsApp/mail y la hoja sin precios", () => {
  assert.equal(L3.numeroRemito(12), "000012");
  assert.equal(L3.numeroRemito(null), "");
  assert.equal(L3.tieneRemito({ estado: "parcial" }), true);
  assert.equal(L3.tieneRemito({ estado: "no_visitado" }), false);
  assert.equal(L3.puedeFirmarPorLink({ estado: "entregado", firma_url: null }), true);
  assert.equal(L3.puedeFirmarPorLink({ estado: "entregado", firma_url: "x" }), false, "ya firmado");
  assert.equal(L3.puedeFirmarPorLink({ estado: "rechazado" }), false, "lo rechazado no se firma");
  assert.equal(L3.linkRemito("https://gypi.app/", TOKEN), `https://gypi.app/remito/${TOKEN}`);
  const t = L3.textoRemito({ empresa: "Muebles", numero: 12, nombre: "Torre Norte", url: "https://x/remito/t", firmar: true });
  assert.match(t, /Remito N° 000012 de Muebles \(Torre Norte\)/);
  assert.match(t, /firmalo desde este link: https:\/\/x\/remito\/t/);
  assert.match(L3.linkWhatsapp("hola y chau"), /^https:\/\/wa\.me\/\?text=hola%20y%20chau$/);
  assert.match(L3.linkMail({ asunto: "Remito", cuerpo: "a b" }), /^mailto:\?subject=Remito&body=a%20b$/);

  const d = {
    empresa: { nombre: "Muebles <Prueba>" },
    viaje: { numero: 7, tipo: "distribucion", fecha: "2026-11-24" },
    parada: {
      nombre: "Torre Norte", direccion: "Libertador 100", cliente: "Pérez", ots: ["7450"], accion: "entregar", estado: "parcial", motivo: "Faltaron 2",
      renglones: [{ texto: "Bulto 1", cantidad: 1, hecha: 1 }, { texto: "Bisagra", cantidad: 24, hecha: 22 }],
      fotos: ["https://s/f1.jpg", "javascript:alert(1)"], firma_url: "https://s/firma.png", firma_nombre: "Ana", firma_dni: "30111222",
      hecha_at: "2026-11-24T15:35:00Z", remito_numero: 12, remito_oficial: "0001-00001234", cot: "987654",
    },
    origen: { nombre: "Planta Pilar", direccion: "Ruta 8" }, chofer: "Carlos", vehiculo: "AB123CD",
  };
  const filas = Object.fromEntries(remitoLib.filasRemito(d));
  assert.equal(filas.Fecha, "24/11/2026 12:35", "en hora argentina");
  assert.equal(filas["Entrega en"], "Torre Norte · Libertador 100");
  assert.equal(filas["Remito oficial"], "0001-00001234");
  assert.equal(filas.COT, "987654");
  assert.equal(filas.Viaje, "N° 7 · Entrega · Entregar");
  const html = remitoLib.htmlRemito(d);
  assert.match(html, /Remito N° 000012/);
  assert.match(html, /Muebles &lt;Prueba&gt;/, "escapa los textos");
  assert.match(html, /22 de 24/);
  assert.match(html, /Ana · DNI 30111222/);
  assert.ok(html.includes('src="https://s/f1.jpg"') && !html.includes("javascript:"), "solo fotos https");
  assert.ok(!/\$|precio/i.test(html), "sin precios");
});

function mockRemito({ parada = {}, ultimo = 11, otroChofer = false, sin206 = false, modulos = null } = {}) {
  const escrito = [];
  const base = { id: 1, viaje_id: 40, empresa_id: E, estado: "entregado", accion: "entregar", nombre: "Torre Norte", ots: ["7450"], renglones: [], fotos: [], remito_numero: null, token: null, ...parada };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("nombre"), respond: () => ({ status: 200, body: [{ nombre: "Muebles", logo_url: null }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01", ...(modulos ? { modulos_apagados: modulos } : {}) }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/logistica_viajes"), respond: () => ({ status: 200, body: [{ id: 40, numero: 7, tipo: "distribucion", fecha: "2026-11-24", estado: "terminado", chofer_id: otroChofer ? "33333333-3333-3333-3333-333333333333" : EMP, origen_id: 1, vehiculo_id: 7 }] }) },
    { match: (u) => u.includes("/rest/v1/logistica_lugares"), respond: () => ({ status: 200, body: [{ nombre: "Planta Pilar", direccion: "Ruta 8" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Carlos" }] }) },
    { match: (u) => u.includes("/rest/v1/vehiculos"), respond: () => ({ status: 200, body: [{ patente: "AB123CD", marca: "Renault", modelo: "Master" }] }) },
    { match: (u) => u.includes("/storage/v1/object/reportes-obra/"), respond: (u, o) => { escrito.push({ tabla: "storage", url: u, metodo: o.method }); return { status: 200, body: {} }; } },
    {
      match: (u) => u.includes("/rest/v1/logistica_paradas"),
      respond: (u, o) => {
        const body = o.body ? JSON.parse(o.body) : null;
        escrito.push({ tabla: "logistica_paradas", metodo: o.method || "GET", url: u, body });
        if (sin206) return { status: 400, body: { code: "42703", message: "column logistica_paradas.remito_numero does not exist" } };
        if (!o.method || o.method === "GET") return { status: 200, body: u.includes("order=remito_numero.desc") ? [{ remito_numero: ultimo }] : [base] };
        return { status: 200, body: [{ ...base, ...body }] };
      },
    },
  ]);
  return escrito;
}

test("/api/logistica remito_preparar y remito_datos — número correlativo y link una sola vez; solo paradas cumplidas", async () => {
  let escrito = mockRemito();
  let res = await api.POST(req(await token("operativo"), { accion: "remito_preparar", id: 1 }));
  assert.equal(res.status, 200);
  let p = (await res.json()).parada;
  assert.equal(p.remito_numero, 12, "el siguiente al último de la empresa");
  assert.match(p.token, /^[A-Za-z0-9_-]{32}$/);
  // Ya numerado: devuelve lo mismo, sin escribir
  escrito = mockRemito({ parada: { remito_numero: 5, token: TOKEN } });
  res = await api.POST(req(await token("operativo"), { accion: "remito_preparar", id: 1 }));
  p = (await res.json()).parada;
  assert.deepEqual([p.remito_numero, p.token], [5, TOKEN]);
  assert.ok(!escrito.some((x) => x.metodo === "PATCH"));
  // Pendiente o no visitada: sin remito
  mockRemito({ parada: { estado: "no_visitado" } });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "remito_preparar", id: 1 }))).status, 409);
  // Otro chofer no; el Dueño sí
  mockRemito({ otroChofer: true });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "remito_preparar", id: 1 }))).status, 403);
  mockRemito({ otroChofer: true });
  assert.equal((await api.POST(req(await token("gerencial"), { accion: "remito_preparar", id: 1 }))).status, 200);
  // Número oficial y COT
  escrito = mockRemito({ parada: { remito_numero: 5, token: TOKEN } });
  res = await api.POST(req(await token("operativo"), { accion: "remito_datos", id: 1, remito_oficial: " 0001-00001234 ", cot: "" }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito.find((x) => x.metodo === "PATCH").body, { remito_oficial: "0001-00001234", cot: null });
  // Sin la 206 avisa
  mockRemito({ sin206: true });
  res = await api.POST(req(await token("operativo"), { accion: "remito_preparar", id: 1 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 206/);
});

test("remito por link — datos sin ids internos; firma una sola vez con nombre; lo rechazado no se firma", async () => {
  mockRemito({ parada: { remito_numero: 12, token: TOKEN, sin_firma: true, hecha_por: EMP, hecha_lat: -34.5, renglones: [{ origen: "bulto", ref: 9, texto: "Bulto 1", cantidad: 1, hecha: 1 }] } });
  const d = await remitoSrv.datosRemito(TOKEN);
  assert.equal(d.empresa.nombre, "Muebles");
  assert.equal(d.parada.remito_numero, 12);
  assert.deepEqual(d.parada.renglones, [{ texto: "Bulto 1", cantidad: 1, hecha: 1 }], "sin ids de bultos");
  assert.equal(d.parada.hecha_por, undefined, "sin quién la cargó");
  assert.equal(d.parada.hecha_lat, undefined, "sin la ubicación del celular");
  assert.deepEqual([d.chofer, d.vehiculo, d.origen.nombre, d.viaje.numero], ["Carlos", "AB123CD · Renault Master", "Planta Pilar", 7]);
  assert.equal(d.puedeFirmar, true);
  assert.equal(await remitoSrv.datosRemito("corto"), null, "token con otra forma");
  mockRemito({ parada: { remito_numero: null, token: TOKEN } });
  assert.equal(await remitoSrv.datosRemito(TOKEN), null, "sin número todavía no hay remito");

  // Firmar por la ruta pública
  let escrito = mockRemito({ parada: { remito_numero: 12, token: TOKEN, sin_firma: true } });
  const pedir = (body) => apiFirmar.POST(new Request("http://localhost/api/remito/firmar", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.9" }, body: JSON.stringify(body) }));
  let res = await pedir({ token: TOKEN, png: PNG_1PX, nombre: "Ana Pérez", dni: "30111222" });
  assert.equal(res.status, 200);
  assert.ok(escrito.some((x) => x.tabla === "storage" && x.url.includes(`/reportes-obra/${E}/`)), "la firma va al storage de la empresa");
  const patch = escrito.find((x) => x.metodo === "PATCH");
  assert.match(patch.url, /firma_url=is.null/, "solo si sigue sin firma");
  assert.deepEqual([patch.body.firma_nombre, patch.body.firma_dni, patch.body.sin_firma, !!patch.body.firmada_link_at], ["Ana Pérez", "30111222", false, true]);
  // Sin nombre, sin firma, ya firmado o rechazado: no
  mockRemito({ parada: { remito_numero: 12, token: TOKEN } });
  assert.equal((await pedir({ token: TOKEN, png: PNG_1PX, nombre: " " })).status, 400);
  mockRemito({ parada: { remito_numero: 12, token: TOKEN } });
  assert.equal((await pedir({ token: TOKEN, png: Buffer.from("no es png").toString("base64"), nombre: "Ana" })).status, 400);
  mockRemito({ parada: { remito_numero: 12, token: TOKEN, firma_url: "https://s/f.png" } });
  assert.equal((await pedir({ token: TOKEN, png: PNG_1PX, nombre: "Ana" })).status, 409);
  mockRemito({ parada: { remito_numero: 12, token: TOKEN, estado: "rechazado" } });
  assert.equal((await pedir({ token: TOKEN, png: PNG_1PX, nombre: "Ana" })).status, 409);
  mockRemito();
  assert.equal((await pedir({ token: "x", png: PNG_1PX, nombre: "Ana" })).status, 404);
});

test("pantallas del remito — en la app numera y arma WhatsApp/mail; la página pública muestra todo y deja firmar", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    enviados.push({ url: String(url), body });
    if (String(url).includes("/api/logistica")) return new Response(JSON.stringify({ ok: true, parada: { id: 1, remito_numero: 12, token: TOKEN, ...(body.accion === "remito_datos" ? { remito_oficial: body.remito_oficial } : {}) } }), { status: 200 });
    if (String(url).includes("/api/remito/firmar")) return new Response(JSON.stringify({ ok: true, firma_url: "https://s/firma.png" }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  render(<RemitoParada parada={{ id: 1, orden: 1, nombre: "Torre Norte", ots: ["7450"], estado: "entregado", sin_firma: true }} empresaNombre="Muebles" onCerrar={() => {}} />);
  await screen.findByRole("heading", { name: "📄 Remito N° 000012" });
  assert.deepEqual(enviados[0].body, { accion: "remito_preparar", id: 1 });
  assert.equal(screen.getByRole("link", { name: /Ver el remito/ }).getAttribute("href"), `http://localhost/remito/${TOKEN}`);
  const wa = decodeURIComponent(screen.getByRole("link", { name: "💬 Mandar por WhatsApp" }).getAttribute("href"));
  assert.match(wa, /Remito N° 000012 de Muebles \(Torre Norte\)\. Por favor, firmalo/);
  assert.match(screen.getByRole("link", { name: "✉️ Mandar por mail" }).getAttribute("href"), /^mailto:\?subject=Remito%20N%C2%B0%20000012/);
  assert.match(document.body.textContent, /Falta la firma de quien recibió/);
  fireEvent.change(screen.getByLabelText("N° de remito oficial"), { target: { value: "0001-00001234" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar números" }));
  await waitFor(() => assert.ok(enviados.some((x) => x.body?.accion === "remito_datos" && x.body.remito_oficial === "0001-00001234" && x.body.cot === null)));
  cleanup();

  const datos = {
    empresa: { nombre: "Muebles", logo: null }, viaje: { numero: 7, tipo: "distribucion", fecha: "2026-11-24" },
    parada: { nombre: "Torre Norte", direccion: "Libertador 100", ots: ["7450"], accion: "entregar", estado: "entregado", renglones: [{ texto: "Bulto 1", cantidad: 1, hecha: 1 }], fotos: ["https://s/f1.jpg"], firma_url: null, sin_firma: true, remito_numero: 12, hecha_at: "2026-11-24T15:35:00Z" },
    origen: null, chofer: "Carlos", vehiculo: "AB123CD", puedeFirmar: true,
  };
  render(<RemitoPublico token={TOKEN} datos={datos} />);
  assert.ok(screen.getByRole("heading", { name: "Remito N° 000012" }));
  assert.match(screen.getByRole("region", { name: "Lo entregado" }).textContent, /Bulto 1/);
  assert.ok(screen.getByRole("img", { name: "Foto 1 de la entrega" }));
  assert.ok(screen.getByRole("button", { name: "📄 Bajar en PDF" }));
  // Sin trazo no firma
  fireEvent.click(screen.getByRole("button", { name: "✍️ Firmar el remito" }));
  assert.match(screen.getByRole("alert").textContent, /Firmá con el dedo/);
});

// ─── Parte 5 (207): abastecimiento con Compras ───

const L5 = await import("../app/lib/logistica.js");

test("abastecimiento — OC para la parada del proveedor, lo que falta llegar y lo que pide para recibirla", () => {
  const ocs = [
    { id: 1, numero: 10, proveedor_id: 5, estado: "enviada" },
    { id: 2, numero: 12, proveedor_id: 5, estado: "recibida_parcial" },
    { id: 3, numero: 11, proveedor_id: 6, estado: "enviada" },
    { id: 4, numero: 13, proveedor_id: 5, estado: "recibida" },
  ];
  assert.deepEqual(L5.ocsParaLugar(ocs, { proveedor_id: 5 }).map((o) => o.numero), [12, 10], "abiertas del proveedor, la más nueva primero");
  assert.deepEqual(L5.ocsParaLugar(ocs, { proveedor_id: null }).map((o) => o.numero), [12, 11, 10], "sin proveedor, todas las abiertas");
  assert.equal(L5.paradaConOc({ lugar_id: 3, accion: "retirar" }), true);
  assert.equal(L5.paradaConOc({ lugar_id: 3, accion: "entregar" }), false);
  assert.equal(L5.paradaConOc({ lugar_id: null, accion: "retirar" }), false);
  const rs = L5.renglonesDeOc([
    { id: 7, sku: "MDF18", descripcion: "MDF 18 mm", unidad: "UN", cantidad: 10, cantidad_recibida: 4 },
    { id: 8, sku: null, descripcion: "Flete", cantidad: 1, cantidad_recibida: 1 },
  ]);
  assert.deepEqual(rs, [{ origen: "oc", ref: 7, ot: null, texto: "MDF18 · MDF 18 mm · UN", cantidad: 6, hecha: 6 }], "solo lo que falta llegar");
  assert.deepEqual(L5.itemsRecibidos([...rs, { origen: "mano", ref: null, cantidad: 1, hecha: 1 }, { origen: "oc", ref: 9, cantidad: 2, hecha: 0 }]), [{ item_id: 7, cantidad: 6 }]);
  const base = { estado: "entregado", accion: "retirar", fotos: ["f"], conOc: true };
  assert.match(L5.faltaParaCumplir({ ...base, renglones: [] }), /cuánto te dieron/);
  assert.match(L5.faltaParaCumplir({ ...base, renglones: rs }), /remito del proveedor/);
  assert.equal(L5.faltaParaCumplir({ ...base, renglones: rs, remito_proveedor: "0001-123" }), null);
  assert.equal(L5.faltaParaCumplir({ ...base, estado: "rechazado", motivo: "No estaba listo", renglones: [] }), null, "si no dieron nada, no pide remito");
  // Validación: la OC va en un lugar donde se retira
  const viaje = (p) => logisticaBody.safeParse({ accion: "viaje_guardar", tipo: "abastecimiento", fecha: "2026-11-25", paradas: [p] });
  assert.equal(viaje({ lugar_id: 3, accion: "retirar", orden_compra_id: 1 }).success, true);
  assert.equal(viaje({ lugar_id: 3, accion: "entregar", orden_compra_id: 1 }).success, false);
  assert.equal(viaje({ ot_ids: [1], accion: "retirar", orden_compra_id: 1 }).success, false);
  assert.equal(logisticaBody.safeParse({ accion: "parada_oc", id: 1 }).success, true);
  // La migración
  const sql = readFileSync(new URL("../supabase/migrations/207_logistica_compras.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /orden_compra_id bigint references public.ordenes_compra/);
  assert.ok(MIGRACIONES.some((m) => m.n === 207 && m.tablas.logistica_paradas.includes("recepcion_id")));
});

function mockCompras({ parada, oc = { id: 9, numero: 31, estado: "enviada", proveedor_nombre: "Maderera López", proveedor_id: 5, moneda: "ARS" }, rpc = null } = {}) {
  const escrito = mockMisViajes({ parada });
  const previo = global.fetch;
  const items = [{ id: 7, orden_id: 9, sku: "MDF18", descripcion: "MDF 18 mm", unidad: "UN", cantidad: 10, cantidad_recibida: 4, precio_unitario: 100 }];
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    const anotar = (tabla) => escrito.push({ tabla, metodo: o.method || "GET", url: u, body: o.body ? JSON.parse(o.body) : null });
    if (u.includes("/rest/v1/ordenes_compra_items")) return new Response(JSON.stringify(items), { status: 200 });
    if (u.includes("/rest/v1/ordenes_compra")) return new Response(JSON.stringify(oc ? [oc] : []), { status: 200 });
    if (u.includes("/rest/v1/rpc/compras_recibir")) {
      anotar("rpc");
      return new Response(JSON.stringify(rpc || { ok: true, recepcion: { id: 55 }, estado: "recibida_parcial", ingresos: 1 }), { status: 200 });
    }
    if (/\/rest\/v1\/(movimientos_stock|recepciones_compra|articulos_stock|empleados)/.test(u)) return new Response("[]", { status: 200 });
    return previo(url, o);
  };
  return escrito;
}

test("/api/logistica con OC — el chofer ve lo pendiente, al retirar queda recibida en Compras una sola vez", async () => {
  const foto = `${SB}/${E}/foto1.jpg`;
  const conOc = { id: 1, viaje_id: 40, accion: "retirar", lugar_id: 3, orden_compra_id: 9, recepcion_id: null };
  // Lo que falta llegar: el chofer lo pide al servidor
  mockCompras({ parada: conOc });
  let res = await api.POST(req(await token("operativo"), { accion: "parada_oc", id: 1 }));
  assert.equal(res.status, 200);
  let r = await res.json();
  assert.deepEqual([r.oc.numero, r.items.length, r.recibida], [31, 1, false]);

  // Sin remito del proveedor no
  mockCompras({ parada: conOc });
  const renglones = [{ origen: "oc", ref: 7, texto: "MDF18 · MDF 18 mm", cantidad: 6, hecha: 4 }];
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "parcial", motivo: "Faltaban 2", renglones, fotos: [foto] }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /remito del proveedor/);

  // Con remito: recepción en Compras con lo retirado, y la parada guarda la recepción
  let escrito = mockCompras({ parada: conOc });
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "parcial", motivo: "Faltaban 2", renglones, fotos: [foto], remito_proveedor: "0001-555" }));
  assert.equal(res.status, 200);
  const rpc = escrito.find((x) => x.tabla === "rpc").body;
  assert.equal(rpc.p_orden, 9);
  assert.equal(rpc.p_recepcion.remito, "0001-555");
  assert.equal(rpc.p_recepcion.foto_url, foto);
  assert.match(rpc.p_recepcion.notas, /viaje N° 7/);
  assert.deepEqual(rpc.p_lineas.map((l) => [l.item_id, l.cantidad, !!l.ingreso]), [[7, 4, true]]);
  const fila = escrito.find((x) => x.tabla === "logistica_paradas" && x.metodo === "PATCH").body;
  assert.deepEqual([fila.recepcion_id, fila.remito_proveedor, fila.estado], [55, "0001-555", "parcial"]);

  // Ya recibida: se corrige la parada sin recibir de nuevo
  escrito = mockCompras({ parada: { ...conOc, recepcion_id: 55, remito_proveedor: "0001-555" } });
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "entregado", renglones: [{ ...renglones[0], hecha: 6 }], fotos: [foto] }));
  assert.equal(res.status, 200);
  assert.ok(!escrito.some((x) => x.tabla === "rpc"), "no recibe dos veces");
  assert.equal(escrito.find((x) => x.tabla === "logistica_paradas" && x.metodo === "PATCH").body.recepcion_id, 55);

  // Si Compras no la puede recibir, la parada no se guarda
  escrito = mockCompras({ parada: conOc, oc: { id: 9, numero: 31, estado: "recibida", proveedor_nombre: "Maderera López" } });
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "entregado", renglones, fotos: [foto], remito_proveedor: "0001-555" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Compras: .*recibió completa/);
  assert.ok(!escrito.some((x) => x.tabla === "logistica_paradas" && x.metodo === "PATCH"));

  // Rechazado (no le dieron nada): no recibe ni pide remito
  escrito = mockCompras({ parada: conOc });
  res = await api.POST(req(await token("operativo"), { accion: "parada_cumplir", id: 1, estado: "rechazado", motivo: "No estaba listo", fotos: [foto] }));
  assert.equal(res.status, 200);
  assert.ok(!escrito.some((x) => x.tabla === "rpc"));

  // Otro operario no ve la OC de un viaje ajeno
  mockMisViajes({ viaje: { id: 40, numero: 7, estado: "en_camino", chofer_id: "33333333-3333-3333-3333-333333333333" }, parada: conOc });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "parada_oc", id: 1 }))).status, 403);
});

test("/api/logistica viaje_guardar con OC — solo de la empresa y por recibir; sin OC no manda la columna", async () => {
  const escribir = (oc) => {
    const escrito = [];
    global.fetch = createFetchMock([
      ...authPassHandlers(),
      { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
      { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
      { match: (u) => u.includes("/rest/v1/logistica_lugares"), respond: () => ({ status: 200, body: [{ id: 3, nombre: "Maderera López", direccion: "Calle 2" }] }) },
      { match: (u) => u.includes("/rest/v1/ordenes_compra"), respond: () => ({ status: 200, body: oc ? [oc] : [] }) },
      {
        match: (u) => u.includes("/rest/v1/logistica_viajes"),
        respond: (u, o) => (!o.method || o.method === "GET" ? { status: 200, body: [] } : { status: 201, body: [{ id: 40, numero: 1, ...JSON.parse(o.body) }] }),
      },
      {
        match: (u) => u.includes("/rest/v1/logistica_paradas"),
        respond: (u, o) => { const b = o.body ? JSON.parse(o.body) : null; escrito.push(b); return { status: 201, body: b || [] }; },
      },
    ]);
    return escrito;
  };
  const cuerpo = (extra) => ({ accion: "viaje_guardar", tipo: "abastecimiento", fecha: "2026-11-25", paradas: [{ lugar_id: 3, accion: "retirar", ...extra }] });
  let escrito = escribir({ id: 9, numero: 31, estado: "enviada" });
  let res = await api.POST(req(await token(), cuerpo({ orden_compra_id: 9 })));
  assert.equal(res.status, 200);
  assert.equal(escrito.flat()[0].orden_compra_id, 9);
  escribir({ id: 9, numero: 31, estado: "recibida" });
  res = await api.POST(req(await token(), cuerpo({ orden_compra_id: 9 })));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /OC N° 31/);
  escribir(null);
  assert.equal((await api.POST(req(await token(), cuerpo({ orden_compra_id: 9 })))).status, 404);
  escrito = escribir(null);
  assert.equal((await api.POST(req(await token(), cuerpo({})))).status, 200);
  assert.ok(!("orden_compra_id" in escrito.flat()[0]), "sin OC, anda aunque falte la 207");
});

test("pantalla Mis viajes con OC — muestra lo pendiente, pide el remito del proveedor y lo manda", async () => {
  const enviados = mockPantallaChofer({
    estadoViaje: "en_camino",
    paradas: [{ id: 2, viaje_id: 40, orden: 1, nombre: "Maderera López", ots: [], lugar_id: 3, direccion: "Calle 2", accion: "retirar", estado: "pendiente", renglones: [], fotos: [], orden_compra_id: 9 }],
  });
  const previo = global.fetch;
  global.fetch = async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null;
    if (String(url).includes("/api/logistica") && body?.accion === "parada_oc") {
      return new Response(JSON.stringify({ ok: true, oc: { id: 9, numero: 31, proveedor_nombre: "Maderera López" }, items: [{ id: 7, sku: "MDF18", descripcion: "MDF 18 mm", unidad: "UN", cantidad: 10, cantidad_recibida: 4 }] }), { status: 200 });
    }
    return previo(url, o);
  };
  render(<MisViajes empleadoId={EMP} viajeId={40} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Parada 1: Maderera López" }));
  assert.ok(await screen.findByText(/Retirás la OC N° 31 · Maderera López/));
  const rs = await screen.findByRole("list", { name: "Renglones" });
  assert.match(rs.textContent, /MDF18 · MDF 18 mm · UN/);
  assert.equal(screen.getByRole("button", { name: "✅ Retiré todo" }).getAttribute("aria-pressed"), "true");
  // Foto (jsdom no carga imágenes)
  const ImagenReal = global.Image;
  const LectorReal = global.FileReader;
  global.FileReader = window.FileReader;
  global.Image = class { set src(_v) { setTimeout(() => this.onerror?.(new Error("sin imágenes"))); } };
  fireEvent.change(screen.getByLabelText("Sacar foto"), { target: { files: [new window.File(["x"], "foto.jpg", { type: "image/jpeg" })] } });
  await screen.findByRole("button", { name: "Ver foto 1" });
  global.Image = ImagenReal;
  global.FileReader = LectorReal;
  fireEvent.click(screen.getByRole("checkbox", { name: /No hay nadie para firmar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar la parada" }));
  assert.match(screen.getByRole("alert").textContent, /remito del proveedor/);
  fireEvent.change(screen.getByLabelText("N° de remito del proveedor"), { target: { value: "0001-555" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar la parada" }));
  await waitFor(() => assert.ok(enviados.some((b) => b.accion === "parada_cumplir")));
  const b = enviados.find((x) => x.accion === "parada_cumplir");
  assert.deepEqual([b.estado, b.remito_proveedor], ["entregado", "0001-555"]);
  assert.deepEqual(b.renglones.map((r) => [r.origen, r.ref, r.cantidad, r.hecha]), [["oc", 7, 6, 6]]);
});

// ─── Parte 6 (208): tablero del dueño y ubicación ───

test("tablero — por chofer y vehículo, firmas pendientes, a tiempo, incidencias y última ubicación", () => {
  const vs = [
    { id: 1, numero: 1, fecha: "2026-11-24", estado: "en_camino", chofer_id: "a", vehiculo_id: 7, ubic_lat: -34.5, ubic_lng: -58.4, ubic_at: "2026-11-24T13:00:00Z", salida_lat: -34.4, salida_lng: -58.9, salida_at: "2026-11-24T11:00:00Z" },
    { id: 2, numero: 2, fecha: "2026-11-24", estado: "planificado", chofer_id: "a", vehiculo_id: 8 },
    { id: 3, numero: 3, fecha: "2026-11-24", estado: "cancelado", chofer_id: "b", vehiculo_id: 7 },
    { id: 4, numero: 4, fecha: "2026-11-20", estado: "terminado", chofer_id: "b", vehiculo_id: 7 },
    { id: 5, numero: 5, fecha: "2026-11-21", estado: "en_camino", chofer_id: null, vehiculo_id: null },
  ];
  const ps = [
    { id: 10, viaje_id: 1, orden: 1, estado: "entregado", hecha_at: "2026-11-24T12:00:00Z", hecha_lat: -34.55, hecha_lng: -58.45, sin_firma: true, firma_url: null },
    { id: 11, viaje_id: 1, orden: 2, estado: "pendiente" },
    { id: 12, viaje_id: 2, orden: 1, estado: "pendiente" },
    { id: 13, viaje_id: 4, orden: 1, estado: "parcial", motivo: "Faltó un bulto", hecha_at: "2026-11-21T15:00:00Z", sin_firma: true, firma_url: "x" },
    { id: 14, viaje_id: 4, orden: 2, estado: "rechazado", motivo: "No era lo pedido", hecha_at: "2026-11-20T15:00:00Z" },
    { id: 15, viaje_id: 5, orden: 1, estado: "pendiente" },
  ];
  const porChofer = L5.viajesPor(vs, ps, "2026-11-24", "chofer_id");
  assert.deepEqual(porChofer.map((g) => [g.clave, g.viajes.length, g.hechas, g.total]), [["a", 2, 1, 3]], "sin los cancelados");
  assert.deepEqual(L5.viajesPor(vs, ps, "2026-11-24", "vehiculo_id").map((g) => g.clave), [7, 8]);
  assert.deepEqual(L5.firmasPendientes(ps).map((p) => p.id), [10], "la que ya firmó por el link no");
  const t = L5.entregasATiempo(vs, ps, { desde: "2026-11-01", hoy: "2026-11-24" });
  assert.deepEqual([t.aTiempo, t.tarde, t.total, t.porcentaje], [2, 1, 3, 67], "la parcial se hizo al día siguiente");
  assert.deepEqual(t.atrasadas.map((p) => p.id), [15], "pendiente de un día anterior");
  assert.deepEqual(L5.incidencias(ps).map((p) => p.id), [13, 14]);
  // La última ubicación: la más nueva entre Gypi abierto, las paradas y la salida
  const u = L5.ultimaUbicacion(vs[0], ps.filter((p) => p.viaje_id === 1));
  assert.deepEqual([u.lat, u.donde], [-34.5, "Gypi abierto"]);
  assert.equal(L5.ultimaUbicacion({ ...vs[0], ubic_at: null }, ps.filter((p) => p.viaje_id === 1)).donde, "parada 1");
  assert.equal(L5.ultimaUbicacion({ id: 9 }, []), null);
  const ahora = new Date("2026-11-24T13:05:00Z").getTime();
  assert.equal(L5.haceCuanto("2026-11-24T13:00:00Z", ahora), "hace 5 min");
  assert.equal(L5.haceCuanto("2026-11-24T10:00:00Z", ahora), "hace 3 h");
  assert.equal(L5.haceCuanto("2026-11-24T13:04:50Z", ahora), "recién");
  // Validación y migración
  assert.equal(logisticaBody.safeParse({ accion: "viaje_ubicacion", id: 1, lat: -34.5, lng: -58.4 }).success, true);
  assert.equal(logisticaBody.safeParse({ accion: "viaje_ubicacion", id: 1, lat: 120, lng: -58.4 }).success, false);
  assert.equal(logisticaBody.safeParse({ accion: "viaje_salir", id: 1, lat: -34.5 }).success, false, "el pin va completo");
  const sql = readFileSync(new URL("../supabase/migrations/208_logistica_ubicacion.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists ubic_at/);
  assert.ok(MIGRACIONES.some((m) => m.n === 208 && m.tablas.logistica_viajes.includes("ubic_lat")));
});

test("/api/logistica ubicación — al salir y terminar; la del chofer en camino; sin la 208 igual sale", async () => {
  let escrito = mockMisViajes({ viaje: { id: 40, numero: 7, estado: "planificado", chofer_id: EMP } });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_salir", id: 40, lat: -34.45, lng: -58.91 }))).status, 200);
  let patch = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH").body;
  assert.deepEqual([patch.estado, patch.salida_lat, patch.salida_lng], ["en_camino", -34.45, -58.91]);
  // Ubicación en vivo: solo el chofer, con el viaje en camino
  escrito = mockMisViajes();
  let res = await api.POST(req(await token("operativo"), { accion: "viaje_ubicacion", id: 40, lat: -34.5, lng: -58.5 }));
  assert.deepEqual(await res.json(), { ok: true, guardada: true });
  patch = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH");
  assert.deepEqual([patch.body.ubic_lat, patch.body.ubic_lng, !!patch.body.ubic_at], [-34.5, -58.5, true]);
  assert.match(patch.url, /estado=eq.en_camino/);
  escrito = mockMisViajes({ viaje: { id: 40, numero: 7, estado: "terminado", chofer_id: EMP } });
  res = await api.POST(req(await token("operativo"), { accion: "viaje_ubicacion", id: 40, lat: -34.5, lng: -58.5 }));
  assert.equal((await res.json()).guardada, false);
  assert.ok(!escrito.some((x) => x.metodo === "PATCH"));
  mockMisViajes({ viaje: { id: 40, numero: 7, estado: "en_camino", chofer_id: "33333333-3333-3333-3333-333333333333" } });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_ubicacion", id: 40, lat: -34.5, lng: -58.5 }))).status, 403);
  // Terminar con ubicación
  escrito = mockMisViajes({ paradas: [{ id: 1, estado: "entregado" }] });
  assert.equal((await api.POST(req(await token("operativo"), { accion: "viaje_terminar", id: 40, lat: -34.46, lng: -58.92 }))).status, 200);
  patch = escrito.find((x) => x.tabla === "logistica_viajes" && x.metodo === "PATCH").body;
  assert.deepEqual([patch.estado, patch.llegada_lat], ["terminado", -34.46]);

  // Sin la 208: sale igual, sin la ubicación
  escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/logistica_viajes"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: [{ id: 40, numero: 7, estado: "planificado", chofer_id: EMP }] };
        const b = JSON.parse(o.body);
        escrito.push(b);
        if ("salida_lat" in b) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'salida_lat' column of 'logistica_viajes' in the schema cache" } };
        return { status: 200, body: [{ id: 40, ...b }] };
      },
    },
  ]);
  res = await api.POST(req(await token("operativo"), { accion: "viaje_salir", id: 40, lat: -34.45, lng: -58.91 }));
  assert.equal(res.status, 200);
  assert.equal(escrito.length, 2);
  assert.ok(!("salida_lat" in escrito[1]));
});

test("pantalla Tablero — en camino con su ubicación, por chofer, sin firma (manda el link) e incidencias", async () => {
  const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const recien = new Date(Date.now() - 4 * 60000).toISOString();
  const D = {
    logistica_viajes: [
      { id: 40, numero: 7, tipo: "distribucion", fecha: HOY, estado: "en_camino", chofer_id: EMP, vehiculo_id: 7, ubic_lat: -34.5, ubic_lng: -58.4, ubic_at: recien },
      { id: 41, numero: 8, tipo: "abastecimiento", fecha: HOY, estado: "planificado", chofer_id: EMP, vehiculo_id: 7 },
    ],
    logistica_paradas: [
      { id: 1, viaje_id: 40, orden: 1, nombre: "Torre Norte", ots: ["7450"], accion: "entregar", estado: "parcial", motivo: "Faltaron 2 bisagras", sin_firma: true, firma_url: null, hecha_at: new Date().toISOString() },
      { id: 2, viaje_id: 40, orden: 2, nombre: "Oficinas Catalinas", ots: [], accion: "entregar", estado: "pendiente" },
      { id: 3, viaje_id: 41, orden: 1, nombre: "Maderera López", ots: [], accion: "retirar", estado: "pendiente" },
    ],
    empleados: [{ id: EMP, nombre: "Carlos Gómez" }],
    vehiculos: [{ id: 7, patente: "AB123CD", marca: "Renault", modelo: "Master" }],
  };
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/logistica")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, parada: { remito_numero: 3, token: "abcdefghijklmnopqrstuvwxyz" } }), { status: 200 });
    }
    const tabla = String(body?.path || url).split("?")[0];
    return new Response(JSON.stringify({ data: D[tabla] || [] }), { status: 200 });
  };
  const { default: LogisticaTablero } = await import("../app/components/LogisticaTablero.jsx");
  render(<LogisticaTablero empresaId={E} />);
  const camino = await screen.findByRole("region", { name: "En camino ahora" });
  assert.match(camino.textContent, /Viaje 7 · en camino · 1 de 2/);
  assert.match(camino.textContent, /Carlos Gómez · AB123CD · sigue: Oficinas Catalinas/);
  assert.match(camino.textContent, /hace 4 min \(Gypi abierto\)/);
  assert.match(screen.getByRole("link", { name: "Ver en el mapa" }).getAttribute("href"), /-34.5,-58.4/);
  assert.match(screen.getByRole("region", { name: "Viajes por chofer" }).textContent, /Carlos Gómez · 1 de 3 paradas/);
  assert.match(screen.getByRole("region", { name: "Viajes por vehículo" }).textContent, /AB123CD · Renault Master · 2 viajes/);
  assert.match(screen.getByRole("region", { name: "Incidencias" }).textContent, /Parcial · Torre Norte.*Faltaron 2 bisagras/);
  assert.match(screen.getByRole("region", { name: "Entregas a tiempo" }).textContent, /1 de 1/);
  // Mandar el link del remito para que firmen
  fireEvent.click(screen.getByRole("button", { name: "Mandar el remito de Torre Norte" }));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "remito_preparar", id: 1 }));
  assert.ok(await screen.findByRole("link", { name: /Mandar por WhatsApp/ }));
});
