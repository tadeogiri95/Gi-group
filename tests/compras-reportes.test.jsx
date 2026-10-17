// tests/compras-reportes.test.jsx — Compras, parte 23 (ítem 41): las OC
// abiertas pasan a fact_ordenes_compra de la planilla MRP (EN TRÁNSITO) y
// quien compra tiene reportes de compras.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { generarClave, ordenesParaPlanilla, scriptPlanilla } from "../app/lib/planillaMrp.js";
import { comprasPorMes, comprasPorProveedor, ordenesAtrasadas, pedidosSinAtender, historialPrecio, nombreMes, ocComprada } from "../app/lib/reportesCompras.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const api = await import("../app/api/stock/planilla/route.js");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const { default: ReportesCompras } = await import("../app/components/ReportesCompras.jsx");

const E = "11111111-1111-1111-1111-111111111111";

const OCS = [
  { id: 1, numero: 1, proveedor_nombre: "Aluar", moneda: "ARS", estado: "recibida", fecha_prometida: "2026-09-10", enviada_at: "2026-09-02T12:00:00Z", created_at: "2026-09-01T12:00:00Z" },
  { id: 2, numero: 2, proveedor_nombre: "Aluar", moneda: "ARS", estado: "enviada", fecha_prometida: "2026-10-10", enviada_at: "2026-10-03T12:00:00Z", created_at: "2026-10-03T12:00:00Z" },
  { id: 3, numero: 3, proveedor_nombre: "Hafele", moneda: "USD", estado: "recibida_parcial", fecha_prometida: "2026-10-20", enviada_at: "2026-10-05T12:00:00Z", created_at: "2026-10-05T12:00:00Z" },
  { id: 4, numero: 4, proveedor_nombre: "Masisa", moneda: "ARS", estado: "borrador", fecha_prometida: null, enviada_at: null, created_at: "2026-10-16T12:00:00Z" },
  { id: 5, numero: 5, proveedor_nombre: "Masisa", moneda: "ARS", estado: "anulada", fecha_prometida: null, enviada_at: "2026-10-06T12:00:00Z", created_at: "2026-10-06T12:00:00Z" },
];
const ITEMS = [
  { orden_id: 1, sku: "3.3.1.6", descripcion: "Perfil 0277", cantidad: 10, precio_unitario: 1000, cantidad_recibida: 10 },
  { orden_id: 2, sku: "3.3.1.6", descripcion: "Perfil 0277", cantidad: 12, precio_unitario: 1200, cantidad_recibida: 0 },
  { orden_id: 2, sku: null, descripcion: "Tornillos 4x40", cantidad: 2, precio_unitario: null, cantidad_recibida: 0 },
  { orden_id: 3, sku: "5.1", descripcion: "Bisagra cazoleta", cantidad: 100, precio_unitario: 2.5, cantidad_recibida: 40 },
  { orden_id: 4, sku: "1.2.3", descripcion: "MDF 18MM", cantidad: 6, precio_unitario: 50000, cantidad_recibida: 0 },
  { orden_id: 5, sku: "1.2.3", descripcion: "MDF 18MM", cantidad: 3, precio_unitario: 40000, cantidad_recibida: 0 },
];

// ─── Planilla: OC abiertas a fact_ordenes_compra ───

test("planilla — de las OC abiertas va lo que falta llegar, solo artículos con SKU", () => {
  const abiertas = OCS.filter((o) => ["borrador", "enviada", "recibida_parcial"].includes(o.estado));
  const filas = ordenesParaPlanilla(abiertas, ITEMS, "America/Argentina/Buenos_Aires");
  assert.deepEqual(filas.map((f) => [f.numero, f.sku, f.cantidad]), [["GY-OC-2", "3.3.1.6", 12], ["GY-OC-3", "5.1", 60], ["GY-OC-4", "1.2.3", 6]]);
  const [perfil, bisagra, mdf] = filas;
  assert.equal(perfil.proveedor, "Aluar");
  assert.equal(perfil.fecha_oc, "2026-10-03");
  assert.equal(perfil.fecha_prometida, "2026-10-10");
  assert.equal(perfil.notas, "GYPI · Enviada");
  assert.equal(bisagra.nombre, "Bisagra cazoleta");
  assert.equal(mdf.fecha_oc, "2026-10-16", "el borrador usa la fecha en que se armó");
  assert.match(mdf.notas, /sin enviar/);
  assert.deepEqual(ordenesParaPlanilla([OCS[0]], ITEMS, null), [], "lo recibido entero no queda en tránsito");
});

function mockRuta({ hash, ocs = null, items = [] }) {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires" }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: { hash } }] }) },
    { match: (u) => u.includes("/rest/v1/movimientos_stock"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra_items"),
      respond: (u) => { pedidos.push(u); return { status: 200, body: items }; },
    },
    {
      match: (u) => u.includes("/rest/v1/ordenes_compra"),
      respond: (u) => {
        pedidos.push(u);
        return ocs ? { status: 200, body: ocs } : { status: 404, body: { message: 'relation "ordenes_compra" does not exist' } };
      },
    },
  ]);
  return pedidos;
}

const pedir = (clave, extra = "") => new Request(`http://localhost/api/stock/planilla?desde=0${extra}`, { headers: { Authorization: `Bearer ${clave}` } });

test("/api/stock/planilla GET — con ordenes=1 trae las OC abiertas de la empresa", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  const pedidos = mockRuta({ hash, ocs: OCS.filter((o) => o.id === 2 || o.id === 3), items: ITEMS.filter((i) => i.orden_id === 2 || i.orden_id === 3) });
  const data = await (await api.GET(pedir(clave, "&ordenes=1"))).json();
  assert.deepEqual(data.ordenes.map((o) => [o.numero, o.cantidad]), [["GY-OC-2", 12], ["GY-OC-3", 60]]);
  assert.match(pedidos[0], /estado=in\.\(borrador,enviada,recibida_parcial\)/);
  assert.match(pedidos[1], /orden_id=in\.\(2,3\)/);
  assert.ok(pedidos.every((p) => p.includes(`empresa_id=eq.${E}`)), "filtrado por la empresa de la clave");

  mockRuta({ hash, ocs: OCS });
  const sinPedir = await (await api.GET(pedir(clave))).json();
  assert.equal("ordenes" in sinPedir, false, "sin ordenes=1 no van (el script viejo sigue igual)");
});

test("/api/stock/planilla GET — sin la tabla de OC no manda ordenes (la planilla no borra nada)", async () => {
  _resetBuckets();
  const { clave, hash } = generarClave(E);
  mockRuta({ hash, ocs: null });
  const res = await api.GET(pedir(clave, "&ordenes=1"));
  assert.equal(res.status, 200);
  assert.equal("ordenes" in (await res.json()), false);
  mockRuta({ hash, ocs: [] });
  assert.deepEqual((await (await api.GET(pedir(clave, "&ordenes=1"))).json()).ordenes, [], "sin OC abiertas: lista vacía, así se limpian las de Gypi");
});

class Hoja {
  constructor(filas, ancho) { this.f = filas.map((r) => [...r, ...Array(ancho).fill("")].slice(0, ancho)); this.ancho = ancho; }
  getMaxRows() { return this.f.length; }
  getLastRow() { for (let i = this.f.length - 1; i >= 0; i--) if (this.f[i].some((v) => v !== "" && v !== null)) return i + 1; return 0; }
  insertRowsAfter(_, n) { for (let i = 0; i < n; i++) this.f.push(Array(this.ancho).fill("")); }
  deleteRow() { throw new Error("no se borran filas: achicaría los rangos de EN TRÁNSITO"); }
  getRange(r, c, nr, nc) {
    const hoja = this;
    return {
      getValues: () => hoja.f.slice(r - 1, r - 1 + nr).map((fila) => fila.slice(c - 1, c - 1 + nc)),
      setValues: (v) => v.forEach((fila, i) => fila.forEach((x, j) => { hoja.f[r - 1 + i][c - 1 + j] = x; })),
      setFormulas: () => {},
      setBackground: () => {},
    };
  }
}

function correrScript(hojas, respuestas) {
  const pedidos = [];
  const props = { GYPI_DESDE: "5" };
  const entorno = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: {
      fetch: (url) => {
        pedidos.push(url);
        const r = respuestas.shift();
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(r) };
      },
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }) },
  };
  const script = scriptPlanilla({ url: "https://gypi.test/api/stock/planilla", clave: "gyp_x" });
  new Function(...Object.keys(entorno), `${script}\ntraerMovimientosGypi();`)(...Object.values(entorno));
  return pedidos;
}

const vacia = () => new Hoja([["ID_INGRESO"]], 13);
const fila = (numero, sku, cantidad, extra = {}) => ({ sku, nombre: `Art ${sku}`, proveedor: "Aluar", cantidad, fecha_oc: "2026-10-03", fecha_prometida: "2026-10-10", numero, notas: "GYPI · Enviada", ...extra });

test("script — deja las OC de Gypi en fact_ordenes_compra como PENDIENTE y respeta lo cargado a mano", () => {
  const ordenes = new Hoja([
    ["SKU", "ARTÍCULO", "PROVEEDOR", "CANTIDAD PEDIDA", "FECHA OC", "FECHA PROMETIDA", "ESTADO", "N° OC", "NOTAS"],
    ["9.9", "Pegamento", "Otro", 4, "", "", "PENDIENTE", "A MANO 1", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
  ], 9);
  const hojas = { fact_consumos_stock: vacia(), fact_ingresos_stock: vacia(), PERSONAL: new Hoja([["id", "nombre"]], 2), fact_ordenes_compra: ordenes };
  const pedidos = correrScript(hojas, [
    { movimientos: [], anulados: [], hasta: 5, hayMas: true, ordenes: [fila("GY-OC-2", "3.3.1.6", 12), fila("GY-OC-3", "5.1", 60, { fecha_prometida: "" }), fila("GY-OC-4", "1.2.3", 6)] },
    { movimientos: [], anulados: [], hasta: 5, hayMas: false },
  ]);
  assert.deepEqual(pedidos, ["https://gypi.test/api/stock/planilla?desde=5&ordenes=1", "https://gypi.test/api/stock/planilla?desde=5"], "las OC se piden una sola vez");
  assert.deepEqual(ordenes.f[1].slice(0, 8), ["9.9", "Pegamento", "Otro", 4, "", "", "PENDIENTE", "A MANO 1"], "lo cargado a mano queda");
  const perfil = ordenes.f[2];
  assert.deepEqual([perfil[0], perfil[2], perfil[3], perfil[6], perfil[7]], ["3.3.1.6", "Aluar", 12, "PENDIENTE", "GY-OC-2"]);
  assert.equal(perfil[4].getDate(), 3);
  assert.equal(perfil[5].getMonth(), 9);
  assert.equal(ordenes.f[3][5], "", "sin fecha prometida queda vacía");
  assert.equal(ordenes.f[4][7], "GY-OC-4", "si no alcanzan las filas se agregan al final");

  // Al rato: la 3 llegó entera y alguien cargó otra a mano debajo
  ordenes.f.push(["7.7", "Lija", "Otro", 1, "", "", "PENDIENTE", "A MANO 2", ""]);
  correrScript(hojas, [{ movimientos: [], anulados: [], hasta: 5, hayMas: false, ordenes: [fila("GY-OC-2", "3.3.1.6", 5), fila("GY-OC-4", "1.2.3", 6)] }]);
  const numeros = ordenes.f.map((r) => r[7]);
  assert.deepEqual(numeros.filter(Boolean), ["N° OC", "A MANO 1", "A MANO 2", "GY-OC-2", "GY-OC-4"], "las de Gypi se rehacen después de lo cargado a mano, sin repetir");
  assert.equal(ordenes.f[numeros.indexOf("GY-OC-2")][3], 5, "con lo que falta ahora");
  assert.equal(ordenes.f.filter((r) => r[0] === "5.1").length, 0, "la que llegó entera ya no está");

  // Sin OC abiertas se limpian las de Gypi; si la respuesta no trae ordenes, no se toca nada
  correrScript(hojas, [{ movimientos: [], anulados: [], hasta: 5, hayMas: false }]);
  assert.equal(ordenes.f.some((r) => r[7] === "GY-OC-2"), true);
  correrScript(hojas, [{ movimientos: [], anulados: [], hasta: 5, hayMas: false, ordenes: [] }]);
  assert.deepEqual(ordenes.f.map((r) => r[7]).filter(Boolean), ["N° OC", "A MANO 1", "A MANO 2"]);
});

test("script — si la planilla no tiene fact_ordenes_compra, sigue con lo demás", () => {
  const hojas = { fact_consumos_stock: vacia(), fact_ingresos_stock: vacia(), PERSONAL: new Hoja([["id", "nombre"]], 2) };
  assert.doesNotThrow(() => correrScript(hojas, [{ movimientos: [], anulados: [], hasta: 5, hayMas: false, ordenes: [fila("GY-OC-2", "3.3.1.6", 12)] }]));
});

// ─── Reportes ───

test("reportes — compras por mes y por proveedor, sin borradores ni anuladas, pesos y dólares aparte", () => {
  assert.equal(ocComprada(OCS[3]), false);
  assert.equal(ocComprada(OCS[4]), false);
  const meses = comprasPorMes(OCS, ITEMS);
  assert.deepEqual(meses.map((m) => [m.mes, m.ARS, m.USD, m.ordenes, m.sinPrecio]), [["2026-10", 14400, 250, 2, 1], ["2026-09", 10000, 0, 1, 0]]);
  const prov = comprasPorProveedor(OCS, ITEMS);
  assert.deepEqual(prov.map((p) => [p.proveedor, p.ARS, p.USD, p.ordenes]), [["Aluar", 24400, 0, 2], ["Hafele", 0, 250, 1]]);
  assert.deepEqual(comprasPorProveedor(OCS, ITEMS, "2026-09").map((p) => p.proveedor), ["Aluar"]);
  assert.equal(nombreMes("2026-10"), "Octubre 2026");
  assert.equal(nombreMes("x"), "x");
});

test("reportes — atrasadas, pedidos sin atender y precio de un artículo", () => {
  const atr = ordenesAtrasadas(OCS, "2026-10-17");
  assert.deepEqual(atr.map((o) => [o.numero, o.dias_atraso]), [[2, 7]], "la recibida entera no; la 3 todavía está en fecha");
  const pedidos = [
    { id: 1, estado: "pendiente", created_at: "2026-10-15T10:00:00Z" },
    { id: 2, estado: "en_oc", created_at: "2026-10-01T10:00:00Z" },
    { id: 3, estado: "pendiente", created_at: "2026-10-10T10:00:00Z" },
  ];
  assert.deepEqual(pedidosSinAtender(pedidos, "2026-10-17").map((p) => [p.id, p.dias_espera]), [[3, 7], [1, 2]]);
  const precios = historialPrecio(OCS, ITEMS, "3.3.1.6");
  assert.deepEqual(precios.map((p) => [p.numero, p.precio, p.cambio]), [[2, 1200, 20], [1, 1000, null]], "del más nuevo al más viejo, con el cambio contra la anterior");
  assert.equal(historialPrecio(OCS, ITEMS, "perfil").length, 2, "también por nombre, sin mayúsculas");
  assert.deepEqual(historialPrecio(OCS, ITEMS, "mdf"), [], "borradores y anuladas no cuentan");
  assert.deepEqual(historialPrecio(OCS, ITEMS, "a"), [], "hace falta escribir algo");
  assert.equal(historialPrecio(OCS, [{ orden_id: 1, sku: "xx", precio_unitario: 0, cantidad: 1 }, { orden_id: 2, sku: "xx", precio_unitario: 5, cantidad: 1 }], "xx")[0].cambio, null, "sin dividir por cero");
});

test("pantalla de reportes — muestra totales, atrasadas, pedidos y busca precios", async () => {
  const pedidosPend = [{ id: 7, sku: null, descripcion: "Tornillos", unidad: "cajas", cantidad: 3, ot: "M-1", estado: "pendiente", empleado_nombre: "Pedro", division: "Herrería", created_at: "2026-10-01T10:00:00Z" }];
  const pedidosApi = [];
  global.fetch = async (url, opts = {}) => {
    const path = (opts.body ? JSON.parse(opts.body) : {}).path || "";
    pedidosApi.push(path);
    const data = path.startsWith("ordenes_compra_items") ? ITEMS
      : path.startsWith("ordenes_compra") ? OCS
        : path.startsWith("pedidos_compra") ? pedidosPend : [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  render(<ReportesCompras empresaId={E} />);
  await screen.findByText("Octubre 2026 · 2 órdenes");
  assert.ok(screen.getByText("$ 14.400 · US$ 250"));
  assert.ok(screen.getByText("Aluar · 2 órdenes"));
  assert.ok(screen.getByText("N° 2 · Aluar"));
  assert.ok(screen.getByText("Tornillos · 3 cajas · OT M-1"));
  assert.ok(pedidosApi.some((p) => p.startsWith("pedidos_compra?estado=eq.pendiente")));
  fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-09" } });
  assert.equal(screen.queryByText("Hafele · 1 orden"), null);
  fireEvent.change(screen.getByLabelText("Buscar artículo"), { target: { value: "perfil" } });
  assert.ok(screen.getByText("$ 1.200"));
  assert.ok(screen.getByText("▲ 20%"));
});

