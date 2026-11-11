// tests/finanzas-movimientos.test.jsx — Finanzas, parte F1b: Movimientos
// (fin_operaciones, migración 171). Cuentas que salen del tipo, caja que hay
// que elegir, asiento con el IVA en su cuenta, dólares, controles al guardar,
// anular sin borrar, y que solo el Dueño entre.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  numero, cajasDelLado, cuentasDelTipo, asientoDe, validarOperacion, movimientoCaja, filtrarOperaciones, hoyAr, inicioMes,
} from "../app/lib/finanzasOperaciones.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/operaciones/route.js");
const { default: FinanzasMovimientos } = await import("../app/components/FinanzasMovimientos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const CUENTAS = [
  { codigo: "01.01.01.001.001", nombre: "Caja", activa: true },
  { codigo: "01.01.01.001.001.01", nombre: "Caja Principal", activa: true },
  { codigo: "01.01.01.001.001.06", nombre: "Caja Tadeo Giri", activa: true },
  { codigo: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", activa: true },
  { codigo: "01.01.01.003.004", nombre: "Banco Comafi CTA CTE", activa: true },
  { codigo: "01.01.01.008.001", nombre: "USD Físico en caja", activa: true },
  { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas", activa: true },
  { codigo: "01.01.03.001.001", nombre: "IVA Credito Fiscal", activa: true },
  { codigo: "01.01.04.001.002", nombre: "Materias Primas", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
  { codigo: "02.01.03.006.001", nombre: "IVA Debito Fiscal", activa: true },
  { codigo: "04.01.01.001.001", nombre: "Ventas", activa: true },
  { codigo: "04.02.01.001.062", nombre: "Viáticos", activa: false },
];
const TESORERIA = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.001.001.06", nombre: "Caja Tadeo Giri", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.004", nombre: "Banco Comafi CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.008.001", nombre: "USD Físico en caja", tipo: "caja", moneda: "USD", activa: true },
];
const TIPOS = [
  { codigo: "COMPRA MP", grupo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", pide_entidad: true, pide_ot: false, pide_cc: true, activo: true },
  { codigo: "PAGO EFECTIVO", grupo: "PAGOS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.001.001", pide_entidad: true, activo: true },
  { codigo: "PAGO TRANSF", grupo: "PAGOS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002", pide_entidad: true, activo: true },
  { codigo: "VENTA IVA", grupo: "VENTAS", cuenta_debe: "01.01.02.001.001", cuenta_haber: "04.01.01.001.001", pide_entidad: true, pide_ot: true, activo: true },
  { codigo: "COBRO USD", grupo: "COBROS", cuenta_debe: "01.01.01.008.001", cuenta_haber: "01.01.02.001.001", pide_entidad: true, activo: true },
  { codigo: "VIEJO", grupo: "OTROS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", activo: false },
];
const CENTROS = [{ codigo: "MADERA", nombre: "Madera", activo: true }];
const PROVEEDORES = [{ id: 5, nombre: "ACERCO S A", activo: true }];
const PROYECTOS = [{ id: 9, ot: "7961", cliente: "RIOFRIO IVAN", obra: "EDIFICIO MAIPU", descripcion: "COCINA" }];
const CTX = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, centros: CENTROS, proveedores: PROVEEDORES, proyectos: PROYECTOS };

// ─── Reglas ───

test("numero — entiende pesos argentinos", () => {
  assert.equal(numero("1.234,56"), 1234.56);
  assert.equal(numero("1234.56"), 1234.56);
  assert.equal(numero("1.500.000"), 1500000);
  assert.equal(numero("$ 300"), 300);
  assert.equal(numero(""), 0);
  assert.ok(Number.isNaN(numero("mil")));
  assert.equal(inicioMes("2026-11-09"), "2026-11-01");
  assert.equal(hoyAr(new Date("2026-11-10T02:00:00Z")), "2026-11-09");
});

test("cajas — la cuenta general obliga a elegir la caja; un banco viene elegido y se cambia por otro banco", () => {
  const caja = cajasDelLado("01.01.01.001.001", TESORERIA);
  assert.equal(caja.defecto, "");
  assert.deepEqual(caja.opciones.map((c) => c.nombre), ["Caja Principal", "Caja Tadeo Giri"]);
  const banco = cajasDelLado("01.01.01.003.002", TESORERIA);
  assert.equal(banco.defecto, "01.01.01.003.002");
  assert.deepEqual(banco.opciones.map((c) => c.tipo), ["banco", "banco"]);
  assert.equal(cajasDelLado("02.01.02.001.001", TESORERIA), null);
  assert.deepEqual(cuentasDelTipo(TIPOS[1], TESORERIA), { cuenta_debe: "02.01.02.001.001", cuenta_haber: "" });
  assert.deepEqual(cuentasDelTipo(TIPOS[2], TESORERIA), { cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002" });
});

test("asiento — una compra con IVA son tres renglones; una venta lleva IVA débito; sin IVA, dos", () => {
  const compra = asientoDe({ tipo: "COMPRA MP", neto: 1000, iva: 210, otros_impuestos: 30, total: 1240, cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001" }, CTX);
  assert.deepEqual(compra.renglones.map((r) => [r.lado, r.nombre, r.importe]), [
    ["debe", "Materias Primas", 1030], ["debe", "IVA Credito Fiscal", 210], ["haber", "Proveedores", 1240],
  ]);
  const venta = asientoDe({ tipo: "VENTA IVA", neto: 1000, iva: 210, total: 1210, cuenta_debe: "01.01.02.001.001", cuenta_haber: "04.01.01.001.001" }, CTX);
  assert.deepEqual(venta.renglones.map((r) => [r.lado, r.nombre, r.importe]), [
    ["debe", "Deudores Por Ventas", 1210], ["haber", "Ventas", 1000], ["haber", "IVA Debito Fiscal", 210],
  ]);
  const pago = asientoDe({ tipo: "PAGO TRANSF", neto: 500, total: 500, cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002" }, CTX);
  assert.equal(pago.renglones.length, 2);
  const sinCuentaIva = asientoDe({ tipo: "COMPRA MP", neto: 100, iva: 21, total: 121, cuenta_debe: "a", cuenta_haber: "b" }, { ...CTX, cuentas: [] });
  assert.equal(sinCuentaIva.renglones.length, 2);
  assert.match(sinCuentaIva.aviso, /IVA Credito Fiscal/);
});

const base = { fecha: "2026-11-09", tipo: "COMPRA MP", proveedor_id: "5", centro_costo: "MADERA", neto: "1.000,00", iva: "210", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001" };

test("guardar — compra correcta: total = neto + IVA, en pesos", () => {
  const { op, errores } = validarOperacion(base, CTX);
  assert.deepEqual(errores, []);
  assert.equal(op.total, 1210);
  assert.equal(op.total_ars, 1210);
  assert.equal(op.proveedor_id, 5);
  assert.equal(op.entidad, null);
  assert.equal(op.origen, "manual");
  assert.equal(op.tipo_cambio, null);
});

test("guardar — lo que hoy marca CHK_CARGA no se puede guardar", () => {
  const error = (cambio) => validarOperacion({ ...base, ...cambio }, CTX).errores.join(" ");
  assert.match(error({ fecha: "" }), /Falta la fecha/);
  assert.match(error({ tipo: "" }), /Falta el tipo/);
  assert.match(error({ tipo: "VIEJO" }), /desactivado/);
  assert.match(error({ neto: "", iva: "" }), /Falta el importe/);
  assert.match(error({ neto: "-5" }), /positivo/);
  assert.match(error({ cuenta_debe: "09.09" }), /no está en el plan/);
  assert.match(error({ cuenta_debe: "04.02.01.001.062" }), /desactivada/);
  assert.match(error({ proveedor_id: "" }), /COMPRA MP pide proveedor o cliente/);
  assert.match(error({ proveedor_id: "77" }), /no está en la lista/);
  assert.match(error({ centro_costo: "" }), /pide centro de costo/);
  assert.match(error({ centro_costo: "NADA" }), /no existe/);
  // Pago en efectivo sin elegir la caja de quién
  assert.match(error({ tipo: "PAGO EFECTIVO", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.001.001" }), /Elegí la caja o el banco del haber/);
  // Pase entre cajas con una sola pata
  assert.match(error({ tipo: "PAGO TRANSF", cuenta_debe: "01.01.01.003.002", cuenta_haber: "01.01.01.003.002" }), /misma cuenta/);
  // Venta sin OT
  assert.match(error({ tipo: "VENTA IVA", cuenta_debe: "01.01.02.001.001", cuenta_haber: "04.01.01.001.001" }), /pide la OT/);
});

test("guardar — dólares: piden tipo de cambio, van a una caja en dólares y guardan el total en pesos", () => {
  const cobro = { fecha: "2026-11-09", tipo: "COBRO USD", entidad: "RIOFRIO IVAN", neto: "1000", moneda: "USD", tipo_cambio: "1.450", cuenta_debe: "01.01.01.008.001", cuenta_haber: "01.01.02.001.001" };
  const { op, errores } = validarOperacion(cobro, CTX);
  assert.deepEqual(errores, []);
  assert.equal(op.total, 1000);
  assert.equal(op.total_ars, 1450000);
  assert.equal(op.entidad, "RIOFRIO IVAN");
  assert.match(validarOperacion({ ...cobro, tipo_cambio: "" }, CTX).errores.join(" "), /tipo de cambio/);
  assert.match(validarOperacion({ ...cobro, moneda: "ARS" }, CTX).errores.join(" "), /USD Físico en caja es en dólares/);
  assert.match(validarOperacion({ ...base, moneda: "USD", tipo_cambio: "1450" }, CTX).errores.join(" "), /caja o banco en dólares/);
});

test("caja — cuánto entra y sale, en la moneda de la caja; las anuladas no cuentan", () => {
  const usd = TESORERIA[4];
  const op = { cuenta_debe: usd.cuenta, cuenta_haber: "01.01.02.001.001", total: 1000, total_ars: 1450000 };
  assert.equal(movimientoCaja(op, usd), 1000);
  assert.equal(movimientoCaja({ ...op, cuenta_debe: "x", cuenta_haber: usd.cuenta }, usd), -1000);
  assert.equal(movimientoCaja({ ...op, anulada_at: "2026-11-09" }, usd), 0);
  const ops = [
    { id: 1, tipo: "COMPRA MP", proveedor_id: 5, cuenta_debe: "a", cuenta_haber: "b", descripcion: "Placas" },
    { id: 2, tipo: "PAGO TRANSF", cuenta_debe: "b", cuenta_haber: "01.01.01.003.002", anulada_at: "2026-11-09" },
    { id: 3, tipo: "PAGO TRANSF", cuenta_debe: "b", cuenta_haber: "01.01.01.003.002", proyecto_id: 9 },
  ];
  assert.deepEqual(filtrarOperaciones(ops).map((o) => o.id), [1, 3]);
  assert.deepEqual(filtrarOperaciones(ops, { anuladas: true }).map((o) => o.id), [1, 2, 3]);
  assert.deepEqual(filtrarOperaciones(ops, { caja: "01.01.01.003.002" }).map((o) => o.id), [3]);
  assert.deepEqual(filtrarOperaciones(ops, { proveedor: "5" }).map((o) => o.id), [1]);
  assert.deepEqual(filtrarOperaciones(ops, { proyecto: "9" }).map((o) => o.id), [3]);
  assert.deepEqual(filtrarOperaciones(ops, { buscar: "placas" }).map((o) => o.id), [1]);
  assert.deepEqual(filtrarOperaciones(ops, { buscar: "acerco" }, (o) => (o.proveedor_id === 5 ? "ACERCO S A" : "")).map((o) => o.id), [1]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body, query = "") => api[metodo](new Request(`http://localhost/api/finanzas/operaciones${query}`, {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ anulada = false } = {}) {
  const escrito = [];
  const leido = [];
  const tabla = { fin_tipos_operacion: TIPOS, fin_cuentas: CUENTAS, fin_tesoreria: TESORERIA, fin_centros_costo: CENTROS, proveedores: PROVEEDORES, proyectos: PROYECTOS };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          escrito.push({ url: u, metodo: o.method, body: JSON.parse(o.body) });
          if (o.method === "PATCH" && anulada) return { status: 200, body: [] };
          return { status: 201, body: [{ id: 33, ...JSON.parse(o.body) }] };
        }
        leido.push(u);
        return { status: 200, body: [{ id: 1, fecha: "2026-11-02", tipo: "COMPRA MP", total: 100, origen: "factura_oc" }] };
      },
    },
    {
      match: (u) => /\/rest\/v1\/(fin_|proveedores|proyectos)/.test(u),
      respond: (u) => ({ status: 200, body: tabla[u.split("/rest/v1/")[1].split("?")[0]] || [] }),
    },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/operaciones — ni la oficina, ni el operario, ni el Supervisor", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "crear", operacion: base })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
});

test("/api/finanzas/operaciones — el Dueño ve el período y las listas para cargar", async () => {
  const { leido } = mockApi();
  const res = await pedir("gerencial", "GET", null, "?desde=2026-11-01&hasta=2026-11-30");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.operaciones.length, 1);
  assert.equal(d.tipos.length, TIPOS.length);
  assert.equal(d.proveedores[0].nombre, "ACERCO S A");
  assert.match(leido[0], /fecha=gte\.2026-11-01&fecha=lte\.2026-11-30/);
  assert.equal((await pedir("gerencial", "GET", null, "?desde=2026-12-01&hasta=2026-11-01")).status, 400);
});

test("/api/finanzas/operaciones — crear valida en el servidor y guarda quién la cargó", async () => {
  const { escrito } = mockApi();
  const mal = await pedir("gerencial", "POST", { accion: "crear", operacion: { ...base, proveedor_id: "" } });
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /pide proveedor/);
  assert.equal(escrito.length, 0);

  const res = await pedir("gerencial", "POST", { accion: "crear", operacion: base });
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.total, 1210);
  assert.equal(escrito[0].body.cargada_por_nombre, "Tadeo");
});

test("/api/finanzas/operaciones — anular no borra: marca quién y cuándo", async () => {
  const { escrito } = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "anular", id: 33 });
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /id=eq\.33&empresa_id=eq\..+&anulada_at=is\.null/);
  assert.equal(escrito[0].body.anulada_por_nombre, "Tadeo");
  assert.ok(escrito[0].body.anulada_at);

  mockApi({ anulada: true });
  assert.equal((await pedir("gerencial", "POST", { accion: "anular", id: 33 })).status, 404);
  assert.equal((await pedir("gerencial", "POST", { accion: "borrar", id: 33 })).status, 400);
});

// ─── Pantalla ───

test("Movimientos — lista del período y nueva operación con el asiento a la vista", async () => {
  const datos = {
    desde: "2026-11-01", hasta: "2026-11-09", truncado: false, ...CTX,
    operaciones: [
      { id: 1, fecha: "2026-11-02", tipo: "COMPRA MP", proveedor_id: 5, neto: 1000, iva: 210, otros_impuestos: 0, total: 1210, total_ars: 1210, moneda: "ARS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", descripcion: "Placas" },
      { id: 2, fecha: "2026-11-03", tipo: "PAGO TRANSF", proveedor_id: 5, neto: 500, total: 500, total_ars: 500, moneda: "ARS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002", anulada_at: "2026-11-04T10:00:00Z" },
    ],
  };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByText("COMPRA MP · ACERCO S A")));
  assert.ok(screen.getByText("1 operación"), "la anulada no se ve");
  fireEvent.click(screen.getByLabelText("Ver anuladas"));
  await waitFor(() => assert.ok(screen.getByText("Anulada")));

  fireEvent.click(screen.getByRole("button", { name: "+ Nueva operación" }));
  // 11/11: ventana grande en la computadora (más ancha, en dos columnas)
  const ventana = screen.getByRole("dialog", { name: "Nueva operación" }).lastElementChild;
  assert.ok(ventana.className.includes("modal-grande"), "usa la ventana grande");
  assert.equal(ventana.style.maxWidth, "1120px");
  fireEvent.change(screen.getByLabelText("Tipo de operación"), { target: { value: "PAGO EFECTIVO" } });
  assert.ok(screen.getByRole("region", { name: "Cuentas y a quién" }));
  assert.ok(screen.getByRole("region", { name: "Importe y detalle" }));
  assert.ok(screen.getByLabelText("Caja o banco que paga"), "pide elegir la caja");
  fireEvent.click(screen.getByRole("button", { name: "Guardar operación" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /Elegí la caja o el banco del haber/));

  fireEvent.change(screen.getByLabelText("Tipo de operación"), { target: { value: "COMPRA MP" } });
  fireEvent.change(screen.getByLabelText("Neto"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("IVA"), { target: { value: "210" } });
  await waitFor(() => assert.ok(screen.getByText("Total: $ 1.210,00")));
  const asiento = screen.getByRole("table", { name: "Asiento" });
  assert.match(asiento.textContent, /IVA Credito Fiscal/);
});

test("Movimientos — sin el libro copiado manda a Configuración", async () => {
  global.fetch = async () => new Response(JSON.stringify({ ...CTX, tipos: [], operaciones: [] }), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByText(/Primero copiá el libro/)));
});

test("/api/finanzas/operaciones — cambiar el tipo de una compra que salió de una factura la confirma", async () => {
  const { escrito } = mockApi();
  const res = await pedir("gerencial", "POST", { accion: "cambiar_tipo", id: 1, tipo: "COMPRA MP", recordar: true });
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.deepEqual([escrito[0].body.tipo, escrito[0].body.cuenta_debe, escrito[0].body.estado], ["COMPRA MP", "01.01.04.001.002", "confirmada"]);
  assert.equal((await pedir("administrativo", "POST", { accion: "cambiar_tipo", id: 1, tipo: "COMPRA MP" })).status, 403);
});

test("Movimientos — una compra de factura muestra de dónde salió, para revisar, y no se anula a mano", async () => {
  const datos = {
    desde: "2026-11-01", hasta: "2026-11-09", truncado: false, ...CTX,
    operaciones: [
      { id: 4, fecha: "2026-11-05", tipo: "COMPRA MP", proveedor_id: 5, neto: 100, iva: 21, otros_impuestos: 0, total: 121, total_ars: 121, moneda: "ARS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", origen: "factura_oc", estado: "para_revisar", descripcion: "Factura A-1 · OC 120" },
      { id: 5, fecha: "2026-11-06", tipo: "PAGO TRANSF", proveedor_id: 5, neto: 50, total: 50, total_ars: 50, moneda: "ARS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002", origen: "manual", estado: "confirmada" },
    ],
  };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByText("🧾 Factura de OC")));
  fireEvent.click(screen.getByLabelText("Solo para revisar (1)"));
  await waitFor(() => assert.ok(screen.getByText("1 operación")));
  fireEvent.click(screen.getByText("COMPRA MP · ACERCO S A"));
  await waitFor(() => assert.ok(screen.getByLabelText("Tipo de compra")));
  assert.ok(screen.getByRole("button", { name: "Confirmar tipo" }));
  assert.equal(screen.queryByRole("button", { name: "Anular operación" }), null);
});

test("Movimientos — el tipo se ve una sola vez (sin MAYÚSCULAS · minúsculas) y con su leyenda", async () => {
  const tipos = [
    ...TIPOS,
    { codigo: "GASTOS DE LOGÍSTICA", nombre: "Gastos de logística", grupo: "GASTOS", cuenta_debe: "04.02.01.001.062", cuenta_haber: "01.01.01.001.001", activo: true },
    { codigo: "SERVICIOS", nombre: "Servicios", grupo: "GASTOS", cuenta_debe: "04.02.01.001.062", cuenta_haber: "01.01.01.001.001", descripcion: "Luz, gas y agua de la planta.", activo: true },
  ];
  global.fetch = async () => new Response(JSON.stringify({ desde: "2026-11-01", hasta: "2026-11-09", truncado: false, ...CTX, tipos, operaciones: [] }), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "+ Nueva operación" })));
  fireEvent.click(screen.getByRole("button", { name: "+ Nueva operación" }));
  const select = screen.getByLabelText("Tipo de operación");
  fireEvent.focus(select);
  const textos = screen.getAllByRole("option").map((o) => o.textContent);
  assert.ok(textos.includes("Gastos de logística"));
  assert.ok(!textos.some((t) => t.includes("GASTOS DE LOGÍSTICA")), "no repite el código en mayúsculas");
  fireEvent.change(select, { target: { value: "GASTOS DE LOGÍSTICA" } });
  assert.match(screen.getByLabelText("Qué comprende este tipo").textContent, /combustible, peajes, fletes/);
  fireEvent.change(select, { target: { value: "SERVICIOS" } });
  assert.match(screen.getByLabelText("Qué comprende este tipo").textContent, /Luz, gas y agua de la planta/, "manda la leyenda propia");
});
