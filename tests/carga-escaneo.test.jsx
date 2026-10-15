// tests/carga-escaneo.test.jsx — Carga de la OT escaneando QR: se elige la
// OT con el QR de la planilla y cada bulto o suelto escaneado se tilda solo
// (un escaneo = el renglón entero). Verde lo cargado, amarillo lo que falta.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { leerQr, otDelQr, cotejarQr, bultosPegados } from "../app/lib/escaneoCarga.js";
import { htmlRotulos, linkCarga, TAMANOS_ETIQUETA } from "../app/lib/carga.js";
import { cargaBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => {
  cleanup();
  delete window.BarcodeDetector;
});

const { default: CargaOt } = await import("../app/components/CargaOt.jsx");
const { default: ElegirOtCarga } = await import("../app/components/ElegirOtCarga.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/carga/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const BULTOS = [
  { id: 1, numero: 1, contenido: "M.izq · Módulo inferior izquierdo", cargado: false },
  { id: 2, numero: 2, contenido: "M.der · Módulo inferior derecho", cargado: true },
];
const SUELTOS = [
  { id: 7, codigo: "EST-11", descripcion: "Enchapado 19mm", cantidad: 8, carga: false },
  { id: 8, codigo: null, descripcion: "PATA PLASTICA - -PZ-6.2.558--PACK 1 PZ", cantidad: 16, carga: false },
  { id: 9, codigo: "EST-11", descripcion: "Enchapado 19mm", cantidad: 2, carga: true },
];

// ─── Lectura de los QR ───

test("leerQr — entiende el QR de la OT, los rótulos de la app y los de la planilla", () => {
  assert.deepEqual(leerQr("M-7495"), { ot: "M-7495" });
  assert.deepEqual(leerQr(" OT 7495 "), { ot: "7495" });
  assert.deepEqual(leerQr("https://app.gypi.com.ar/gi?carga=M-7495"), { ot: "M-7495" });
  assert.deepEqual(leerQr("https://app.gypi.com.ar/gi?carga=M-7495&bulto=3"), { ot: "M-7495", bulto: 3 });
  assert.deepEqual(leerQr("https://app.gypi.com.ar/gi?carga=M-7495&suelto=42"), { ot: "M-7495", sueltoId: 42 });
  assert.deepEqual(leerQr("OT M-7495 - BULTO 3 DE 4 - M.izq"), { ot: "M-7495", bulto: 3 });
  assert.deepEqual(leerQr("OT M-7495 - SUELTO - 51 - estante doble"), { ot: "M-7495", suelto: "51 - estante doble" });
  for (const malo of ["", "hola mundo", "https://otro.sitio/x", "https://app.gypi.com.ar/gi?carga=a b", "x".repeat(600)]) {
    assert.equal(leerQr(malo), null, malo.slice(0, 30));
  }
});

test("otDelQr — elige la OT activa del QR, sin importar mayúsculas", () => {
  const ots = [{ ot: "M-7038" }, { ot: "M-7495" }];
  assert.equal(otDelQr("m-7495", ots), "M-7495");
  assert.equal(otDelQr("OT M-7495 - BULTO 1 DE 4 - M.izq", ots), "M-7495", "un rótulo también sirve para elegir la OT");
  assert.equal(otDelQr("M-9999", ots), null);
});

test("cotejarQr — tilda lo que es de la OT y avisa lo que no", () => {
  const datos = { ot: "M-7495", bultos: BULTOS, sueltos: SUELTOS };
  let r = cotejarQr("OT M-7495 - BULTO 1 DE 2 - M.izq", datos);
  assert.equal(r.tipo, "bulto");
  assert.equal(r.item.id, 1);
  assert.equal(r.yaCargado, false);
  assert.equal(r.nombre, "Bulto 1 de 2");
  assert.equal(cotejarQr("https://x.com/gi?carga=M-7495&bulto=2", datos).yaCargado, true);
  assert.match(cotejarQr("OT M-7495 - BULTO 5 DE 5 - M.x", datos).error, /no tiene el bulto 5/);
  assert.match(cotejarQr("OT M-7038 - BULTO 1 DE 2 - M.izq", datos).error, /OT M-7038, no de esta/);
  assert.match(cotejarQr("cualquier cosa", datos).error, /no es de Gypi/);

  r = cotejarQr("OT M-7495 - SUELTO - est-11", datos);
  assert.equal(r.item.id, 7, "con el código repetido, primero el que falta");
  assert.equal(cotejarQr("OT M-7495 - SUELTO - PATA PLASTICA - -PZ-6.2.558--PACK 1 PZ", datos).item.id, 8, "sin código, por la descripción");
  assert.equal(cotejarQr("https://x.com/gi?carga=M-7495&suelto=9", datos).yaCargado, true);
  assert.match(cotejarQr("OT M-7495 - SUELTO - ZOC-T1", datos).error, /no está en la lista/);
  assert.deepEqual(cotejarQr("M-7495", datos), { tipo: "ot" });
});

test("bultosPegados — la columna ETIQUETA de la planilla, sin título ni vacíos", () => {
  const pegado = "ETIQUETA (pegar en Gypi → 🏷 Módulos)\nM.izq · Módulo inferior izquierdo\t\n\nM.der ·  Módulo derecho\r\n";
  assert.deepEqual(bultosPegados(pegado), ["M.izq · Módulo inferior izquierdo", "M.der · Módulo derecho"]);
  assert.deepEqual(bultosPegados(""), []);
});

test("rótulos — cada bulto lleva su propio QR (link con el número)", async () => {
  assert.equal(linkCarga("https://app.gypi.com.ar/", "gi", "M-7495", { bulto: 3 }), "https://app.gypi.com.ar/gi?carga=M-7495&bulto=3");
  assert.equal(linkCarga("https://app.gypi.com.ar", "gi", "7038", { suelto: null }), "https://app.gypi.com.ar/gi?carga=7038");
  const html = await htmlRotulos({
    empresa: "GI", proyecto: { ot: "M-7495" }, tamano: TAMANOS_ETIQUETA[0], link: "https://a.com/gi?carga=M-7495",
    bultos: [{ numero: 1, link: "https://a.com/gi?carga=M-7495&bulto=1" }, { numero: 2, link: "https://a.com/gi?carga=M-7495&bulto=2" }],
  });
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g);
  assert.equal(svgs.length, 2);
  assert.notEqual(svgs[0], svgs[1], "los QR son distintos");
});

// ─── Servidor: pegar los bultos de la planilla ───

test("/api/carga — bultos_pegar crea los bultos numerados después del último", async () => {
  assert.ok(cargaBody.safeParse({ accion: "bultos_pegar", ot: "M-7495", contenidos: ["M.izq"] }).success);
  assert.ok(!cargaBody.safeParse({ accion: "bultos_pegar", ot: "M-7495", contenidos: [] }).success);
  assert.ok(!cargaBody.safeParse({ accion: "bultos_pegar", ot: "M-7495", contenidos: Array(201).fill("x") }).success);

  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: () => ({ status: 200, body: [{ id: 1, ot: "M-7495" }] }) },
    { match: (u, o) => u.includes("/rest/v1/cargas_ot") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/bultos_ot") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ numero: 2 }] }) },
    { match: (u, o) => u.includes("/rest/v1/bultos_ot") && o?.method === "POST", respond: (u, o) => { const b = JSON.parse(o.body); escrito.push(b); return { status: 201, body: b }; } },
  ]);
  const t = (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "operativo" })).token;
  const res = await api.POST(new Request("http://localhost/api/carga", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ accion: "bultos_pegar", ot: "M-7495", contenidos: ["M.izq", "M.der"] }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(escrito[0].map((b) => [b.numero, b.contenido, b.empresa_id, b.creado_por]), [[3, "M.izq", E, EMP], [4, "M.der", E, EMP]]);
  assert.equal((await res.json()).bultos.length, 2);
});

// ─── Pantallas ───

/** Cámara de mentira: cada QR de la cola se "lee" una vez. */
function camaraFalsa(cola) {
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"]; }
    async detect() { const t = cola.shift(); return t ? [{ rawValue: t }] : []; }
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
}

function mockPantalla({ bultos = BULTOS, sueltos = SUELTOS } = {}) {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/carga") || u.includes("/api/sueltos")) {
      const body = JSON.parse(opts.body);
      pedidos.push({ url: u, ...body });
      if (body.accion === "bultos_pegar") return Response.json({ ok: true, bultos: body.contenidos.map((c, i) => ({ id: 100 + i, numero: i + 1, contenido: c, cargado: false })) });
      return Response.json({ ok: true });
    }
    const path = JSON.parse(opts.body).path || "";
    const data = path.startsWith("proyectos") ? [{ ot: "M-7495", cliente: "Siciliano" }]
      : path.startsWith("bultos_ot") ? bultos
      : path.startsWith("sueltos_ot") ? sueltos
      : [];
    return Response.json({ data });
  };
  return pedidos;
}

test("pantalla — verde lo cargado, amarillo lo que falta", async () => {
  mockPantalla();
  render(<CargaOt ot="M-7495" empresaId={E} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Bulto 1 de 2")));
  const fila = (texto) => screen.getByText(texto).closest("li").className;
  assert.match(fila("Bulto 1 de 2"), /yellow/);
  assert.match(fila("Bulto 2 de 2"), /gypi-green/);
});

test("pantalla — escanear: tilda el bulto y el suelto leídos y avisa lo ajeno", async () => {
  const cola = ["OT M-7038 - BULTO 1 DE 2 - M.izq", "OT M-7495 - BULTO 1 DE 2 - M.izq", "OT M-7495 - SUELTO - EST-11"];
  camaraFalsa(cola);
  const pedidos = mockPantalla();
  render(<CargaOt ot="M-7495" empresaId={E} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("📷 Escanear carga"));
  await waitFor(() => assert.ok(pedidos.some((p) => p.accion === "bulto_tildar")), { timeout: 3000 });
  await waitFor(() => assert.ok(pedidos.some((p) => p.url === "/api/sueltos")), { timeout: 3000 });
  assert.deepEqual(pedidos.find((p) => p.accion === "bulto_tildar"), { url: "/api/carga", accion: "bulto_tildar", id: 1, valor: true });
  assert.deepEqual(pedidos.find((p) => p.url === "/api/sueltos"), { url: "/api/sueltos", accion: "tildar", id: 7, columna: "carga", valor: true });
  assert.equal(pedidos.length, 2, "el QR de otra OT no tilda nada");
  await waitFor(() => assert.match(screen.getByText("Bulto 1 de 2").closest("li").className, /gypi-green/));
});

test("pantalla — sin bultos, se pegan los de la planilla", async () => {
  const pedidos = mockPantalla({ bultos: [], sueltos: [] });
  render(<CargaOt ot="M-7495" empresaId={E} onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText("Bultos pegados de la planilla"), { target: { value: "ETIQUETA\nM.izq · Izquierdo\nM.der · Derecho" } });
  fireEvent.click(screen.getByText("📋 Crear 2 bultos"));
  await waitFor(() => assert.ok(screen.getByText("Bulto 2 de 2")));
  assert.deepEqual(pedidos[0].contenidos, ["M.izq · Izquierdo", "M.der · Derecho"]);
});

test("elegir la OT — escaneando el QR de la planilla", async () => {
  camaraFalsa(["M-9999", "m-7495"]);
  global.fetch = async () => Response.json({ ok: true, data: [{ id: 1, ot: "M-7038" }, { id: 2, ot: "M-7495" }] });
  const elegidas = [];
  render(<ElegirOtCarga empresaId={E} onElegir={(ot) => elegidas.push(ot)} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("📷 Escanear el QR de la OT"));
  await waitFor(() => assert.deepEqual(elegidas, ["M-7495"]), { timeout: 3000 });
});
