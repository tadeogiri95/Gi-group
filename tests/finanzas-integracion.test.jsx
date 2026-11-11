// tests/finanzas-integracion.test.jsx — Finanzas, parte 9 del plan del 11/11:
// Finanzas unida con Flota, Maquinaria y Stock. Los costos de arreglos se
// cargan como gasto con un toque y sin repetir; el stock valorizado contra la
// contabilidad.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  costosMantenimiento, gastoDeCosto, grupoDeVinculo, stockValorizado, vinculoDeGrupo, vinculoValido,
} from "../app/lib/finanzasIntegracion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const apiIntegracion = await import("../app/api/finanzas/integracion/route.js");
const apiOperaciones = await import("../app/api/finanzas/operaciones/route.js");
const { CostosMantenimiento, StockValorizado } = await import("../app/components/FinanzasIntegracion.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const TIPOS = [
  { codigo: "GASTOS DE LOGÍSTICA", nombre: "Gastos de logística", grupo: "GASTOS", cuenta_debe: "04.02.01.001.030", cuenta_haber: "02.01.02.001.001", activo: true },
  { codigo: "GASTOS DE MANTENIMIENTO", nombre: "Gastos de mantenimiento", grupo: "GASTOS", cuenta_debe: "04.02.01.001.031", cuenta_haber: "02.01.02.001.001", activo: true },
];
const CUENTAS = [
  { codigo: "01.01.01.001.001", nombre: "Caja", activa: true },
  { codigo: "01.01.04.001.002", nombre: "Materias Primas", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
  { codigo: "02.01.02.003.001", nombre: "Acreedores Varios", activa: true },
  { codigo: "04.02.01.001.030", nombre: "Mantenimiento de rodados", activa: true },
  { codigo: "04.02.01.001.031", nombre: "Mantenimiento", activa: true },
];
const TESORERIA = [{ cuenta: "01.01.01.001.001", nombre: "Caja", tipo: "caja", moneda: "ARS", activa: true }];
const PROVEEDORES = [{ id: 5, nombre: "Taller Gómez S.R.L.", activo: true }];
const VEHICULOS = [{ id: 3, patente: "ab123cd", marca: "Ford", modelo: "Ranger" }];
const MAQUINAS = [{ id: 8, codigo: "SEC-1", nombre: "Seccionadora" }];
const MANTENIMIENTOS = [
  { id: 12, vehiculo_id: 3, tipo: "service", fecha: "2026-11-03", donde: "taller", taller: "Gómez Taller", detalle: "Aceite y filtros", costo: 85000, factura_url: "https://test.supabase.co/storage/v1/object/public/reportes-obra/f.pdf" },
  { id: 13, vehiculo_id: 3, tipo: "reparacion", fecha: "2026-10-20", donde: "interno", taller: null, detalle: "Luz de freno", costo: 0, factura_url: null },
  { id: 14, vehiculo_id: 3, tipo: "arreglo", fecha: "2026-09-10", donde: "taller", taller: "Otro", detalle: "Frenos", costo: 50000, factura_url: null },
];
const FALLAS = [
  { id: 7, maquina_id: 8, descripcion: "Correa", detalle: "Cambio de correa", estado: "resuelta", costo: 120000.5, factura_url: null, cerrado_at: "2026-11-01T15:00:00Z" },
  { id: 9, maquina_id: 8, descripcion: "Ruido", estado: "pendiente", costo: 999 },
];

// ─── Reglas ───

test("vínculo — el gasto unido a un arreglo tiene una clave fija, compatible con los gastos", () => {
  assert.deepEqual(vinculoValido("v:12"), { modulo: "vehiculo", id: 12 });
  assert.deepEqual(vinculoValido("m:7"), { modulo: "maquina", id: 7 });
  assert.equal(vinculoValido("x:1"), null);
  assert.equal(vinculoValido("v:0"), null);
  assert.equal(vinculoValido("v:1; drop"), null);
  const g = grupoDeVinculo({ modulo: "vehiculo", id: 12 });
  assert.equal(g, "ga0000000000c");
  assert.match(g, /^g[0-9a-f]{12}$/, "se anula como cualquier gasto");
  assert.deepEqual(vinculoDeGrupo(g), { modulo: "vehiculo", id: 12 });
  assert.deepEqual(vinculoDeGrupo("gb00000000007-p"), { modulo: "maquina", id: 7 });
  assert.equal(vinculoDeGrupo("g3f9a00b1c2d4"), null, "un gasto suelto no es de un arreglo");
});

test("costosMantenimiento — los que tienen costo y no están en Finanzas; los ya cargados se cuentan", () => {
  const ops = [
    { origen_id: grupoDeVinculo({ modulo: "vehiculo", id: 14 }), total: 50000 },
    { origen_id: `${grupoDeVinculo({ modulo: "vehiculo", id: 14 })}-p`, total: 50000 },
    { origen_id: grupoDeVinculo({ modulo: "vehiculo", id: 12 }), total: 85000, anulada_at: "2026-11-05" },
  ];
  const r = costosMantenimiento({ mantenimientos: MANTENIMIENTOS, fallas: FALLAS, vehiculos: VEHICULOS, maquinas: MAQUINAS, ops });
  assert.deepEqual(r.pendientes.map((p) => [p.vinculo, p.fecha, p.costo]), [["v:12", "2026-11-03", 85000], ["m:7", "2026-11-01", 120000.5]], "el anulado vuelve a quedar pendiente");
  assert.equal(r.pendientes[0].titulo, "🚚 Service · Ford Ranger AB123CD");
  assert.equal(r.pendientes[1].titulo, "⚙ Falla · SEC-1 · Seccionadora");
  assert.equal(r.pendientes[1].detalle, "Correa: Cambio de correa");
  assert.deepEqual(r.cargados, { n: 1, total: 50000 }, "el pago del gasto no cuenta dos veces");
});

test("gastoDeCosto — el formulario viene lleno: tipo por módulo, su cuenta, importe, fecha y el taller como proveedor", () => {
  const [veh, maq] = costosMantenimiento({ mantenimientos: MANTENIMIENTOS, fallas: FALLAS, vehiculos: VEHICULOS, maquinas: MAQUINAS }).pendientes;
  const g = gastoDeCosto(veh, { tipos: TIPOS, proveedores: PROVEEDORES });
  assert.deepEqual([g.vinculo, g.tipo, g.cuenta_gasto, g.fecha_factura, g.mes, g.neto, g.con_factura], ["v:12", "GASTOS DE LOGÍSTICA", "04.02.01.001.030", "2026-11-03", "2026-11", "85000", false]);
  assert.equal(g.proveedor_id, "5", "Gómez Taller = Taller Gómez S.R.L.");
  assert.match(g.descripcion, /^Service · Ford Ranger AB123CD · Aceite y filtros$/);
  const m = gastoDeCosto(maq, { tipos: TIPOS, proveedores: PROVEEDORES });
  assert.deepEqual([m.tipo, m.neto, m.proveedor_id], ["GASTOS DE MANTENIMIENTO", "120000,5", ""]);
});

test("stockValorizado — stock × último precio contra los bienes de cambio de Gypi", () => {
  const articulos = [
    { sku: "A", familia: "Placas", stock: 10, ultimo_precio: 1000 },
    { sku: "B", familia: "Placas", stock: 2, ultimo_precio: 500 },
    { sku: "C", familia: "Herrajes", stock: 100, ultimo_precio: 15.5 },
    { sku: "D", familia: "Herrajes", stock: 5, ultimo_precio: null },
    { sku: "E", familia: "Cantos", stock: 0, ultimo_precio: 99 },
  ];
  const ops = [
    { cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", total: 9000 },
    { cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", total: 5000, anulada_at: "x" },
    { cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", total: 7000, estado: "para_revisar" },
  ];
  const s = stockValorizado({ articulos, cuentas: CUENTAS, ops });
  assert.equal(s.valorizado, 12550);
  assert.equal(s.articulos, 4);
  assert.equal(s.sin_precio, 1);
  assert.deepEqual(s.por_familia, [{ familia: "Placas", valor: 11000 }, { familia: "Herrajes", valor: 1550 }]);
  assert.equal(s.contable, 9000);
  assert.deepEqual(s.cuentas, [{ codigo: "01.01.04.001.002", nombre: "Materias Primas", saldo: 9000 }]);
  assert.equal(s.diferencia, 3550);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function mockServidor({ yaCargado = false, sinFlota = false } = {}) {
  const escrito = [];
  const leido = [];
  const tabla = {
    fin_tipos_operacion: TIPOS, fin_cuentas: CUENTAS, fin_tesoreria: TESORERIA, fin_centros_costo: [], proveedores: PROVEEDORES, proyectos: [],
    vehiculos: VEHICULOS, maquinas: MAQUINAS, vehiculo_mantenimientos: MANTENIMIENTOS, maquina_fallas: FALLAS.filter((f) => f.estado === "resuelta"),
    articulos_stock: [{ sku: "A", familia: "Placas", stock: 10, ultimo_precio: 1000, activo: true }],
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { const b = JSON.parse(o.body); escrito.push(b); return { status: 201, body: b.map((x, i) => ({ id: 60 + i, ...x })) }; }
        leido.push(decodeURIComponent(u));
        if (u.includes("origen_id=eq.")) return { status: 200, body: yaCargado ? [{ fecha: "2026-11-04" }] : [] };
        if (u.includes("01.01.04")) return { status: 200, body: [{ cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", total: 4000 }] };
        return { status: 200, body: [{ origen_id: grupoDeVinculo({ modulo: "vehiculo", id: 14 }), total: 50000 }] };
      },
    },
    {
      match: (u) => /\/rest\/v1\/(fin_|proveedores|proyectos|vehicul|maquina|articulos_stock)/.test(u),
      respond: (u) => {
        const t = u.split("/rest/v1/")[1].split("?")[0];
        if (sinFlota && t.startsWith("vehicul")) return { status: 404, body: { message: "relation does not exist" } };
        let filas = tabla[t] || [];
        const id = /[?&]id=eq\.(\d+)/.exec(u);
        if (id) filas = filas.filter((f) => String(f.id) === id[1]);
        return { status: 200, body: filas };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/integracion — solo el Dueño; costos pendientes con el gasto lleno y el stock; sin Flota esa parte vacía", async () => {
  mockServidor();
  const pedir = async (rol) => apiIntegracion.GET(new Request("http://localhost/api/finanzas/integracion", { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await pedir("administrativo")).status, 403);
  const d = await (await pedir("gerencial")).json();
  assert.deepEqual(d.mantenimiento.pendientes.map((p) => p.vinculo), ["v:12", "m:7"], "el 14 ya está en Finanzas");
  assert.equal(d.mantenimiento.pendientes[0].inicial.tipo, "GASTOS DE LOGÍSTICA");
  assert.deepEqual(d.mantenimiento.cargados, { n: 1, total: 50000 });
  assert.deepEqual([d.stock.valorizado, d.stock.contable, d.stock.diferencia], [10000, 4000, 6000]);

  mockServidor({ sinFlota: true });
  const sin = await (await pedir("gerencial")).json();
  assert.deepEqual(sin.mantenimiento.pendientes.map((p) => p.vinculo), ["m:7"]);
});

const pedirOp = async (body) => apiOperaciones.POST(new Request("http://localhost/api/finanzas/operaciones", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("gerencial")}` }, body: JSON.stringify(body),
}));
const GASTO = { vinculo: "v:12", tipo: "GASTOS DE LOGÍSTICA", cuenta_gasto: "04.02.01.001.030", con_factura: false, fecha_factura: "2026-11-03", mes: "2026-11", proveedor_id: 5, neto: 85000, iva: 0, otros_impuestos: 0 };

test("/api/finanzas/operaciones gasto con vínculo — queda unido al arreglo con su clave fija y no se carga dos veces", async () => {
  let { escrito } = mockServidor();
  const ok = await pedirOp({ accion: "gasto", gasto: GASTO });
  assert.equal(ok.status, 200);
  assert.equal(escrito[0][0].origen_id, "ga0000000000c");
  assert.equal(escrito[0][0].origen, "gasto");
  assert.equal(escrito[0][0].vinculo, undefined, "el vínculo no es una columna");

  ({ escrito } = mockServidor({ yaCargado: true }));
  const otra = await pedirOp({ accion: "gasto", gasto: GASTO });
  assert.equal(otra.status, 409);
  assert.match((await otra.json()).error, /ya está cargado en Finanzas \(operación del 04\/11\/2026\)/);
  assert.equal(escrito.length, 0);

  mockServidor();
  assert.equal((await pedirOp({ accion: "gasto", gasto: { ...GASTO, vinculo: "v:999" } })).status, 404);
  assert.equal((await pedirOp({ accion: "gasto", gasto: { ...GASTO, vinculo: "nada" } })).status, 404);
});

test("/api/finanzas/operaciones leer_gasto con vínculo — solo baja facturas del almacenamiento de Gypi", async () => {
  mockServidor();
  const sinFactura = await pedirOp({ accion: "leer_gasto", vinculo: "m:7" });
  assert.equal(sinFactura.status, 400);
  assert.match((await sinFactura.json()).error, /no tiene una factura/);
  assert.equal((await pedirOp({ accion: "leer_gasto", vinculo: "v:999" })).status, 404);
});

// ─── Pantalla ───

const DATOS_GASTO = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, centros: [], proveedores: PROVEEDORES, proyectos: [] };

test("Costos de Flota y Maquinaria — aviso, lista y Cargar abre el gasto lleno y unido al arreglo", async () => {
  const pendientes = costosMantenimiento({ mantenimientos: MANTENIMIENTOS, fallas: FALLAS, vehiculos: VEHICULOS, maquinas: MAQUINAS }).pendientes
    .map((p) => ({ ...p, inicial: gastoDeCosto(p, { tipos: TIPOS, proveedores: PROVEEDORES }) }));
  const enviado = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviado.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, operaciones: [] }), { status: 200 }); }
    return new Response(JSON.stringify({ hoy: "2026-11-11", mantenimiento: { pendientes, cargados: { n: 2, total: 1000 } }, stock: null }), { status: 200 });
  };
  let cargado = 0;
  render(<CostosMantenimiento datosGasto={DATOS_GASTO} onCargado={() => { cargado++; }} />);
  fireEvent.click(await screen.findByRole("button", { name: /3 costos de Flota y Maquinaria|2 costos de Flota y Maquinaria/ }));
  const lista = screen.getByLabelText("Costos para pasar a Finanzas");
  assert.match(lista.textContent, /Service · Ford Ranger AB123CD.*Gómez Taller.*con factura/);
  assert.match(screen.getByText(/Ya cargados: 2/).textContent, /\$ 1\.000,00/);
  fireEvent.click(screen.getByRole("button", { name: "Cargar 🚚 Service · Ford Ranger AB123CD" }));
  assert.match(screen.getByLabelText("Arreglo de origen").textContent, /Viene de 🚚 Service · Ford Ranger AB123CD \(03\/11\/2026\)/);
  assert.ok(screen.getByRole("button", { name: "📎 Leer la factura del arreglo" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => assert.equal(cargado, 1));
  assert.equal(enviado[0].accion, "gasto");
  assert.equal(enviado[0].gasto.vinculo, "v:12");
  assert.equal(enviado[0].gasto.neto, 85000);
  assert.equal(String(enviado[0].gasto.proveedor_id), "5");
});

test("Stock valorizado — tarjetas y barras por familia; sin stock no aparece", async () => {
  const stock = stockValorizado({ articulos: [{ familia: "Placas", stock: 10, ultimo_precio: 1000 }, { familia: "Herrajes", stock: 3, ultimo_precio: null }], cuentas: CUENTAS, ops: [{ cuenta_debe: "01.01.04.001.002", cuenta_haber: "x", total: 4000 }] });
  global.fetch = async () => new Response(JSON.stringify({ mantenimiento: { pendientes: [], cargados: { n: 0, total: 0 } }, stock }), { status: 200 });
  render(<StockValorizado />);
  const s = await screen.findByLabelText("Stock valorizado");
  assert.match(s.textContent, /Stock valorizado\$ 10\.000,00/);
  assert.match(s.textContent, /En la contabilidad\$ 4\.000,00Materias Primas/);
  assert.match(s.textContent, /Hay más stock que en la contabilidad/);
  assert.match(s.textContent, /1 artículo con stock no tiene último precio/);
  assert.match(screen.getByLabelText("Stock por familia").textContent, /Placas/);
  cleanup();
  global.fetch = async () => new Response(JSON.stringify({ mantenimiento: { pendientes: [], cargados: { n: 0, total: 0 } }, stock: null }), { status: 200 });
  const { container } = render(<StockValorizado />);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(container.textContent, "");
});
