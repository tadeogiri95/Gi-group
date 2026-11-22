// tests/finanzas-estado-cuenta.test.jsx — Finanzas → 📒 Cuentas corrientes:
// 📄 Estado de cuenta en PDF para mandarle al cliente o al proveedor (20/11,
// sin migración). Datos de mentira.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { conceptoProveedor, estadoCliente, estadoProveedor, htmlEstadoCuenta, nombreArchivoEstado, textoSaldo } from "../app/lib/finanzasEstadoCuenta.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/estado-cuenta/route.js");
const { default: BotonEstadoCuenta, armarEstadoCuenta } = await import("../app/components/FinanzasEstadoCuenta.jsx");

const HOY = "2026-11-20";
const CLI = {
  nombre: "Constructora Ejemplo", cuit: "30-11111111-1",
  ots: [
    { proyecto_id: 1, ot: "7795", obra: "Edificio Norte", descripcion: "Cocina", fecha: "2026-08-05", valor: 1000 },
    { proyecto_id: 2, ot: "7796", obra: "Edificio Norte", descripcion: "Placares", fecha: "2026-09-02", valor: 500 },
    { proyecto_id: 3, ot: "7797", obra: "Casa Sur", descripcion: "Baño", fecha: "2026-11-03", valor: 0, sin_valor: true },
  ],
  cobros: [
    { fecha: "2026-08-12", importe: 600, proyecto_id: 1 },
    { fecha: "2026-10-01", importe: 700, proyecto_id: null },
  ],
};

test("cliente — cada OT con su precio (con o sin IVA), los pagos y el saldo renglón por renglón; la OT sin precio va aparte", () => {
  const s = estadoCliente(CLI, { hoy: HOY });
  assert.deepEqual(s.movimientos.map((m) => [m.fecha, m.concepto, m.cargo, m.abono, m.saldo]), [
    ["2026-08-05", "OT 7795", 1000, 0, 1000],
    ["2026-08-12", "Pago recibido", 0, 600, 400],
    ["2026-09-02", "OT 7796", 500, 0, 900],
    ["2026-10-01", "Pago recibido", 0, 700, 200],
  ]);
  assert.equal(s.movimientos[0].detalle, "Edificio Norte · Cocina", "obra y descripción, sin decir Factura");
  assert.equal(s.movimientos[1].detalle, "OT 7795 · Edificio Norte · Cocina");
  assert.deepEqual([s.anterior, s.cargos, s.abonos, s.saldo], [0, 1500, 1300, 200]);
  assert.deepEqual(s.a_confirmar.map((o) => o.concepto), ["OT 7797"], "sin precio: no suma, va a confirmar");
  // Pendiente: la 7795 tiene 400 y el pago suelto la cancela primero; sobran 300 para la 7796
  assert.deepEqual(s.pendientes.map((p) => [p.concepto, p.falta, p.dias]), [["OT 7796 · Edificio Norte · Placares", 200, 79]]);
  assert.equal(s.textos.cargos, "Total de OT (sin IVA)");
  // 201: solo la OT con "Lleva IVA" va × 1,21 y lo dice en el detalle
  const unaConIva = { ...CLI, ots: CLI.ots.map((o) => (o.ot === "7795" ? { ...o, lleva_iva: true } : o)) };
  const iva = estadoCliente(unaConIva, { hoy: HOY });
  assert.deepEqual([iva.cargos, iva.saldo], [1710, 410]);
  assert.equal(iva.movimientos[0].detalle, "Edificio Norte · Cocina · con IVA");
  assert.equal(iva.movimientos[2].detalle, "Edificio Norte · Placares");
  assert.equal(iva.textos.cargos, "Total de OT");
  const todas = estadoCliente({ ...CLI, ots: CLI.ots.map((o) => ({ ...o, lleva_iva: true })) }, { hoy: HOY });
  assert.deepEqual([todas.cargos, todas.textos.cargos], [1815, "Total de OT (con IVA)"]);
});

test("cliente — con fechas: saldo anterior, solo los movimientos del período y corte en hasta", () => {
  const s = estadoCliente(CLI, { desde: "2026-09-01", hasta: "2026-09-30", hoy: HOY });
  assert.equal(s.anterior, 400);
  assert.deepEqual(s.movimientos.map((m) => m.saldo), [900]);
  assert.equal(s.saldo, 900);
  assert.deepEqual(s.pendientes.map((p) => p.falta), [400, 500], "al 30/09 el pago suelto todavía no estaba");
  assert.equal(s.a_confirmar.length, 0, "la OT sin precio es de noviembre");
});

const op = (fecha, extra = {}) => ({ fecha, referencia: null, origen: "manual", descripcion: "", ...extra });
const MOVS = [
  { op: op("2026-08-08", { referencia: "0005-00012001", origen: "factura_oc" }), compra: 1880, pago: 0 },
  { op: op("2026-08-20", { origen: "orden_pago" }), compra: 0, pago: 1000 },
  { op: op("2026-09-09", { referencia: "0005-00012233", origen: "sos" }), compra: 900, pago: 0 },
  { op: op("2026-09-15", { referencia: "88", origen: "compra_manual", descripcion: "Nota de crédito" }), compra: 0, pago: 100 },
];

test("proveedor — comprobantes, pagos y notas de crédito sin la descripción interna; pendientes a las más viejas", () => {
  assert.deepEqual(conceptoProveedor(op("2026-01-01", { origen: "saldo_inicial" }), 5), { concepto: "Saldo inicial", detalle: "" });
  assert.deepEqual(conceptoProveedor(op("2026-01-01", { descripcion: "Nafta del camión de Juan" }), 5), { concepto: "Compra", detalle: "" });
  const s = estadoProveedor(MOVS, { hoy: HOY });
  assert.deepEqual(s.movimientos.map((m) => [m.concepto, m.detalle, m.saldo]), [
    ["Comprobante 0005-00012001", "", 1880],
    ["Pago", "", 880],
    ["Comprobante 0005-00012233", "", 1780],
    ["Nota de crédito", "N° 88", 1680],
  ]);
  assert.deepEqual(s.pendientes.map((p) => [p.concepto, p.falta]), [["Comprobante 0005-00012001", 780], ["Comprobante 0005-00012233", 900]]);
});

test("la hoja — lo del otro lado se lee bien, sin estimados ni costos; cliente y proveedor juntos con el neto", () => {
  assert.equal(textoSaldo("cliente", 10), "Saldo a su cargo");
  assert.equal(textoSaldo("proveedor", 10), "Saldo a su favor");
  assert.equal(textoSaldo("neto", -5), "Saldo a su favor");
  assert.equal(nombreArchivoEstado("Construcción <Ñandú> S.A.", HOY), "Estado de cuenta - Construccion Nandu S.A. - 2026-11-20.pdf");
  const empresa = { nombre: "Gi Group SRL", cuit: "30-00000000-0", logo: "javascript:alert(1)", color: "red;}" };
  const solo = htmlEstadoCuenta({ empresa, nombre: "Constructora <b>", cliente: estadoCliente(CLI, { hoy: HOY }), hoy: HOY });
  assert.match(solo, /ESTADO DE CUENTA/);
  assert.match(solo, /Constructora &lt;b&gt;/);
  assert.match(solo, /OT 7795/);
  assert.match(solo, /OT con monto a confirmar/);
  assert.match(solo, /Todos los movimientos al 20\/11\/2026/);
  assert.doesNotMatch(solo, /Factura|material|estimad|costo|margen/i);
  assert.doesNotMatch(solo, /javascript:|red;\}/, "logo y color inseguros no entran");
  const ambos = htmlEstadoCuenta({ empresa, nombre: "Mixto", cliente: estadoCliente(CLI, { hoy: HOY }), proveedor: estadoProveedor(MOVS, { hoy: HOY }), hoy: HOY });
  assert.match(ambos, /Cuenta como cliente/);
  assert.match(ambos, /Cuenta como proveedor/);
  assert.match(ambos, /Saldo a su favor \(neto\)/, "le debemos 1680 y nos debe 515: neto a su favor");
});

test("armarEstadoCuenta — junta lo que trae la API", () => {
  const d = armarEstadoCuenta({ empresa: { nombre: "X" }, cliente: CLI, proveedor: { nombre: "P", cuit: "", movimientos: MOVS } }, { hoy: HOY });
  assert.equal(d.nombre, "Constructora Ejemplo");
  assert.equal(d.cuit, "30-11111111-1");
  assert.equal(d.cliente.saldo, 200, "sin IVA salvo las OT marcadas (201)");
  assert.equal(d.proveedor.saldo, 1680);
});

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const DEU = "01.01.02.001.001";
const PROV = "02.01.01.001.001";
const BANCO = "01.01.01.003.002";
const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

test("/api/finanzas/estado-cuenta — solo el Dueño; nunca manda estimados, descripciones ni cuentas", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: (u) => ({ status: 200, body: [u.includes("razon_social") ? { nombre: "Gi", razon_social: "Gi Group SRL", cuit: "30-1", logo_url: "https://x/logo.png", color_primario: "#123456" } : { plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: [{ codigo: DEU, nombre: "Deudores Por Ventas" }, { codigo: PROV, nombre: "Proveedores" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: [{ id: 1, nombre: "Hotel Norte", cuit: "30-2" }] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [{ id: 5, nombre: "Maderas", cuit: "30-3" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [
      { id: 101, ot: "7001", cliente: "Hotel Norte", obra: "Lobby", descripcion: "Mostrador", created_at: "2026-09-10T12:00:00Z" },
      { id: 102, ot: "7002", cliente: "Hotel Norte", obra: "Habitaciones", created_at: "2026-10-05T12:00:00Z" },
    ] }) },
    { match: (u) => u.includes("/rest/v1/precios_ot"), respond: () => ({ status: 200, body: [{ ot: "7001", precio: 1000 }] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => {
      pedidos.push(decodeURIComponent(u));
      return { status: 200, body: [
        { id: 1, fecha: "2026-09-20", cliente_id: 1, proyecto_id: 101, total_ars: 500, cuenta_debe: BANCO, cuenta_haber: DEU, descripcion: "cobro interno" },
        { id: 2, fecha: "2026-09-21", proveedor_id: 5, total_ars: 300, cuenta_debe: "GASTO", cuenta_haber: PROV, referencia: "A-1", origen: "sos", descripcion: "nota interna del proveedor" },
      ] };
    } },
    { match: (u) => u.includes("/rest/v1/necesidades_stock"), respond: () => { throw new Error("no se leen materiales"); } },
  ]);
  const pedir = async (rol, q) => api.GET(new Request(`http://localhost/api/finanzas/estado-cuenta?${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await pedir("administrativo", "cliente=c1")).status, 403);
  assert.equal((await pedir("gerencial", "")).status, 400);
  assert.equal((await pedir("gerencial", "cliente=c1;drop")).status, 400);
  const res = await pedir("gerencial", "cliente=c1&proveedor=p5");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.empresa.nombre, "Gi Group SRL");
  assert.equal(d.cliente.cuit, "30-2");
  assert.deepEqual(d.cliente.ots.map((o) => [o.ot, o.valor, o.sin_valor]), [["7001", 1000, false], ["7002", 0, true]]);
  assert.deepEqual(d.cliente.cobros, [{ fecha: "2026-09-20", importe: 500, proyecto_id: 101 }]);
  assert.deepEqual(d.proveedor.movimientos, [{ op: { fecha: "2026-09-21", referencia: "A-1", origen: "sos", descripcion: "" }, compra: 300, pago: 0 }]);
  const todo = JSON.stringify(d);
  assert.doesNotMatch(todo, /interna|interno|cuenta_debe|cuenta_haber|materiales|estimado/);
});

test("botón — abre la ventanita con todo el historial por defecto, fechas a elección y el IVA solo para clientes", () => {
  render(<BotonEstadoCuenta cliente="c1" nombre="Hotel Norte" />);
  fireEvent.click(screen.getByRole("button", { name: /Estado de cuenta en PDF/ }));
  assert.ok(screen.getByText("Todo el historial"));
  assert.equal(screen.queryByLabelText("Desde"), null);
  fireEvent.click(screen.getByText("Elegir fechas"));
  assert.ok(screen.getByLabelText("Desde"));
  assert.ok(screen.getByText(/Las OT van sin IVA, salvo/));
  cleanup();
  render(<BotonEstadoCuenta proveedor="p5" nombre="Maderas" />);
  fireEvent.click(screen.getByRole("button", { name: /Estado de cuenta en PDF/ }));
  assert.equal(screen.queryByText(/Las OT van sin IVA, salvo/), null);
  cleanup();
  const { container } = render(<BotonEstadoCuenta />);
  assert.equal(container.innerHTML, "");
});
