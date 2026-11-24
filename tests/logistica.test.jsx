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
  assert.deepEqual(opcionesBoton("logistica", planta, { rol: "gerencial" }).map((o) => o.id), ["log-viajes", "log-lugares"]);
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
