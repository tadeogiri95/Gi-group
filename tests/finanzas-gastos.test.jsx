// tests/finanzas-gastos.test.jsx — Finanzas, parte 5 del plan del 11/11:
// gasto devengado con o sin factura. Va al mes en que ocurrió, deja la deuda
// con el proveedor (o en Acreedores Varios, IIBB a pagar…), el IVA solo en
// facturas A o M, el pago si ya se pagó, y se anula junto con su pago.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  finDeMes, fechaDevengado, textoComprobante, cuentasDeuda, operacionesGasto, ORIGEN_GASTO, tiposDeGasto, deudaDelTipo, esquemaGasto, proveedorDeFactura, propuestaDeLectura,
} from "../app/lib/finanzasGastos.js";
import { asientoDe } from "../app/lib/finanzasOperaciones.js";

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
  { codigo: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", activa: true },
  { codigo: "01.01.01.008.001", nombre: "USD Físico en caja", activa: true },
  { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas", activa: true },
  { codigo: "01.01.03.001.001", nombre: "IVA Credito Fiscal", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
  { codigo: "02.01.02.003.001", nombre: "Acreedores Varios", activa: true },
  { codigo: "02.01.03.002.001", nombre: "Impuesto IIBB A Pagar", activa: true },
  { codigo: "02.01.03.009.001", nombre: "Viejo a pagar", activa: false },
  { codigo: "04.01.01.001.001", nombre: "Ventas", activa: true },
  { codigo: "04.02.01.001.010", nombre: "Energía Eléctrica", activa: true },
  { codigo: "04.02.01.001.020", nombre: "Impuesto a los Ingresos Brutos", activa: true },
];
const TESORERIA = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.008.001", nombre: "USD Físico en caja", tipo: "caja", moneda: "USD", activa: true },
];
const TIPOS = [
  { codigo: "SERVICIOS", nombre: "Servicios", grupo: "GASTOS", cuenta_debe: "04.02.01.001.010", cuenta_haber: "01.01.01.001.001", pide_cc: true, activo: true },
  { codigo: "IIBB", nombre: "Ingresos Brutos", grupo: "IMPUESTOS", cuenta_debe: "04.02.01.001.020", cuenta_haber: "02.01.03.002.001", activo: true },
  { codigo: "PAGO TRANSF", grupo: "PAGOS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.003.002", activo: true },
  { codigo: "VENTA IVA", grupo: "VENTAS", cuenta_debe: "01.01.02.001.001", cuenta_haber: "04.01.01.001.001", activo: true },
  { codigo: "RETIRO", grupo: "CAJA", cuenta_debe: "01.01.01.001.001", cuenta_haber: "01.01.01.003.002", activo: true },
];
const CENTROS = [{ codigo: "PLANTA", nombre: "Planta", activo: true }];
const PROVEEDORES = [{ id: 5, nombre: "EPEC", activo: true }];
const PROYECTOS = [{ id: 9, ot: "7961", cliente: "RIOFRIO IVAN", obra: "EDIFICIO MAIPU", descripcion: "COCINA" }];
const CTX = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, centros: CENTROS, proveedores: PROVEEDORES, proyectos: PROYECTOS };

const LUZ = {
  tipo: "SERVICIOS", cuenta_gasto: "04.02.01.001.010", con_factura: true, letra: "A", punto_venta: "3", numero: "1234",
  fecha_factura: "2026-11-05", mes: "2026-10", proveedor_id: 5, neto: 1000, iva: 210, otros_impuestos: 30, centro_costo: "PLANTA",
};

// ─── Reglas ───

test("fecha — el gasto va a su mes: último día si la factura llega después, primer día si es de un mes que viene", () => {
  assert.equal(finDeMes("2026-02"), "2026-02-28");
  assert.equal(finDeMes("2026-12"), "2026-12-31");
  assert.equal(fechaDevengado("2026-11-05", "2026-10"), "2026-10-31");
  assert.equal(fechaDevengado("2026-11-05", "2026-11"), "2026-11-05");
  assert.equal(fechaDevengado("2026-11-25", "2026-12"), "2026-12-01");
  assert.equal(fechaDevengado("2026-11-05", ""), "2026-11-05", "sin mes, la de la factura");
});

test("comprobante — letra, punto de venta y número con sus ceros; sin factura dice sin factura", () => {
  assert.equal(textoComprobante({ con_factura: true, letra: "A", punto_venta: "3", numero: "1234" }), "Factura A 00003-00001234");
  assert.equal(textoComprobante({ con_factura: true, letra: "C" }), "Factura C");
  assert.equal(textoComprobante({ con_factura: false, numero: "R-12" }), "Sin factura (comprobante R-12)");
  assert.equal(textoComprobante({ con_factura: false }), "Sin factura");
  assert.deepEqual(cuentasDeuda(CUENTAS).map((c) => c.nombre), ["Proveedores", "Acreedores Varios", "Impuesto IIBB A Pagar"]);
});

test("gasto con factura A de otro mes — deuda con el proveedor, IVA crédito aparte y fecha en el mes del gasto", () => {
  const { ops, errores } = operacionesGasto(LUZ, CTX);
  assert.deepEqual(errores, []);
  assert.equal(ops.length, 1);
  const [g] = ops;
  assert.equal(g.fecha, "2026-10-31");
  assert.equal(g.origen, ORIGEN_GASTO);
  assert.deepEqual([g.cuenta_debe, g.cuenta_haber, g.proveedor_id, g.total], ["04.02.01.001.010", "02.01.02.001.001", 5, 1240]);
  assert.equal(g.referencia, "A 00003-00001234");
  assert.match(g.descripcion, /Factura A 00003-00001234 del 05\/11\/26 \(gasto de 10\/2026\)/);
  const { renglones } = asientoDe(g, CTX);
  assert.deepEqual(renglones.map((r) => [r.lado, r.nombre, r.importe]), [
    ["debe", "Energía Eléctrica", 1030], ["debe", "IVA Credito Fiscal", 210], ["haber", "Proveedores", 1240],
  ]);
});

test("gasto sin factura y ya pagado — queda en la cuenta elegida y se carga el pago desde la caja", () => {
  const { ops, errores } = operacionesGasto({
    tipo: "IIBB", cuenta_gasto: "04.02.01.001.020", con_factura: false, fecha_factura: "2026-11-10", mes: "2026-10",
    cuenta_deuda: "02.01.03.002.001", entidad: "Rentas Córdoba", neto: 5000, iva: 99, pagado: true, cuenta_caja: "01.01.01.003.002", fecha_pago: "2026-11-12",
  }, CTX);
  assert.deepEqual(errores, []);
  assert.equal(ops.length, 2);
  assert.deepEqual([ops[0].fecha, ops[0].cuenta_haber, ops[0].iva, ops[0].total, ops[0].entidad], ["2026-10-31", "02.01.03.002.001", 0, 5000, "Rentas Córdoba"]);
  assert.deepEqual([ops[1].fecha, ops[1].cuenta_debe, ops[1].cuenta_haber, ops[1].total, ops[1].tipo], ["2026-11-12", "02.01.03.002.001", "01.01.01.003.002", 5000, "IIBB"]);
  assert.match(ops[1].descripcion, /^Pago de Sin factura/);
});

test("gasto — lo que no se puede guardar", () => {
  const err = (d) => operacionesGasto({ ...LUZ, ...d }, CTX).errores.join(" | ");
  assert.match(err({ tipo: "" }), /Elegí el tipo de gasto/);
  assert.match(err({ cuenta_gasto: "01.01.01.003.002" }), /no puede ser una caja/);
  assert.match(err({ cuenta_gasto: "02.01.02.003.001" }), /una deuda/);
  assert.match(err({ proveedor_id: "" }), /Elegí el proveedor o la cuenta/);
  assert.match(err({ proveedor_id: "", cuenta_deuda: "04.02.01.001.010" }), /Elegí el proveedor o la cuenta/);
  assert.match(err({ proveedor_id: "", cuenta_deuda: "02.01.03.009.001" }), /Elegí el proveedor o la cuenta/, "una deuda desactivada no");
  assert.match(err({ proveedor_id: 77 }), /no está en la lista/);
  assert.match(err({ neto: 0 }), /mayor a cero/);
  assert.match(err({ letra: "B" }), /Solo las facturas A/);
  assert.match(err({ centro_costo: "" }), /pide centro de costo/);
  assert.match(err({ centro_costo: "NADA" }), /no existe/);
  assert.match(err({ pagado: true }), /con qué caja/);
  assert.match(err({ pagado: true, cuenta_caja: "01.01.01.008.001" }), /en pesos/);
  assert.match(err({ fecha_factura: "" }), /fecha de la factura/);
  assert.match(operacionesGasto({ ...LUZ, proveedor_id: 5 }, { ...CTX, cuentas: CUENTAS.filter((c) => c.nombre !== "Proveedores") }).errores.join(), /Falta la cuenta "Proveedores"/);
});

test("pantalla — tipos que sirven para un gasto y la deuda que propone cada uno", () => {
  assert.deepEqual(tiposDeGasto(TIPOS, TESORERIA).map((t) => t.codigo), ["SERVICIOS", "IIBB"]);
  assert.equal(deudaDelTipo(TIPOS[1], CUENTAS), "02.01.03.002.001");
  assert.equal(deudaDelTipo(TIPOS[0], CUENTAS), "02.01.02.003.001", "si el tipo sale de la caja, Acreedores Varios");
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/operaciones", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));

function mockApi({ op = { origen: "gasto", origen_id: "gabcdef012345-p" }, repetida = null, lectura = null } = {}) {
  const escrito = [];
  const ia = [];
  const tabla = { fin_tipos_operacion: TIPOS, fin_cuentas: CUENTAS, fin_tesoreria: TESORERIA, fin_centros_costo: CENTROS, proveedores: PROVEEDORES, proyectos: PROYECTOS };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    {
      match: (u) => u.includes("api.anthropic.com"),
      respond: (u, o) => {
        ia.push(JSON.parse(o.body));
        return { status: 200, body: { content: [{ type: "text", text: JSON.stringify(lectura) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, model: "m" } };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/fin_operaciones") && u.includes("referencia=eq.") && !o?.method, respond: () => ({ status: 200, body: repetida ? [repetida] : [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ url: u, metodo: o.method, body });
          return { status: 201, body: Array.isArray(body) ? body.map((b, i) => ({ id: 40 + i, ...b })) : [{ id: 40, ...body }, { id: 41, ...body }] };
        }
        return { status: 200, body: [op] };
      },
    },
    {
      match: (u) => /\/rest\/v1\/(fin_|proveedores|proyectos)/.test(u),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ url: u, metodo: o.method, body });
          return { status: 201, body: [{ id: 88, ...body }] };
        }
        if (u.includes("proveedores?") && u.includes("nombre=ilike.")) return { status: 200, body: [] };
        return { status: 200, body: tabla[u.split("/rest/v1/")[1].split("?")[0]] || [] };
      },
    },
  ]);
  escrito.ia = ia;
  return escrito;
}

test("/api/finanzas/operaciones gasto — valida en el servidor y guarda el gasto y su pago como un grupo", async () => {
  const escrito = mockApi();
  const mal = await pedir("gerencial", { accion: "gasto", gasto: { ...LUZ, letra: "C" } });
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /Solo las facturas A/);
  assert.equal(escrito.length, 0);
  assert.equal((await pedir("administrativo", { accion: "gasto", gasto: LUZ })).status, 403);

  const res = await pedir("gerencial", { accion: "gasto", gasto: { ...LUZ, pagado: true, cuenta_caja: "01.01.01.001.001.01" } });
  assert.equal(res.status, 200);
  const filas = escrito[0].body;
  assert.equal(filas.length, 2);
  assert.match(filas[0].origen_id, /^g[0-9a-f]{12}$/);
  assert.equal(filas[1].origen_id, `${filas[0].origen_id}-p`);
  assert.deepEqual(filas.map((f) => [f.empresa_id, f.cargada_por_nombre, f.origen]), [[E, "Tadeo", "gasto"], [E, "Tadeo", "gasto"]]);
  assert.equal(filas[1].cuenta_haber, "01.01.01.001.001.01");
  const recordado = escrito.find((x) => x.url.includes("/proveedores?id=eq.5"));
  assert.deepEqual(recordado?.body, { fin_tipo: "SERVICIOS" }, "EPEC no tenía tipo: queda guardado para la próxima");
});

test("/api/finanzas/operaciones gasto — la misma factura del mismo proveedor no se carga dos veces", async () => {
  const escrito = mockApi({ repetida: { id: 12, fecha: "2026-10-31" } });
  const res = await pedir("gerencial", { accion: "gasto", gasto: LUZ });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /ya está cargada \(operación del 31\/10\/2026\)/);
  assert.equal(escrito.filter((x) => x.metodo === "POST").length, 0);
});

test("/api/finanzas/operaciones anular — un gasto se anula junto con su pago; una de factura sigue sin poder anularse a mano", async () => {
  let escrito = mockApi();
  const res = await pedir("gerencial", { accion: "anular", id: 41 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).anuladas, 2);
  assert.match(decodeURIComponent(escrito[0].url), /origen=eq\.gasto&origen_id=in\.\(gabcdef012345,gabcdef012345-p\)/);

  escrito = mockApi({ op: { origen: "factura_oc", origen_id: "12" } });
  await pedir("gerencial", { accion: "anular", id: 41 });
  assert.match(escrito[0].url, /id=eq\.41&.*origen=eq\.manual/);
});

// ─── Pantalla ───

test("Movimientos — 🧾 Cargar gasto: factura de octubre que llega en noviembre, asiento a la vista y se guarda", async () => {
  const datos = { desde: "2026-11-01", hasta: "2026-11-11", truncado: false, ...CTX, operaciones: [] };
  const enviado = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviado.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" })));
  fireEvent.click(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /Elegí el tipo de gasto/));

  fireEvent.change(screen.getByLabelText("Tipo de gasto"), { target: { value: "Servicios" } });
  assert.match(screen.getByText(/Va a la cuenta/).textContent, /Energía Eléctrica/);
  fireEvent.change(screen.getByLabelText("Proveedor del gasto"), { target: { value: "EPEC" } });
  fireEvent.change(screen.getByLabelText("Fecha de la factura"), { target: { value: "2026-11-05" } });
  fireEvent.change(screen.getByLabelText("Mes del gasto"), { target: { value: "2026-10" } });
  assert.ok(screen.getByText("Va a octubre 2026: se anota con fecha 31/10/26."));
  fireEvent.change(screen.getByLabelText("Neto (sin IVA)"), { target: { value: "1.000,00" } });
  fireEvent.change(screen.getByLabelText("IVA"), { target: { value: "210" } });
  fireEvent.change(screen.getByLabelText("Centro de costo (obligatorio)"), { target: { value: "PLANTA" } });
  await waitFor(() => assert.ok(screen.getByText("Total: $ 1.210,00")));
  const asiento = screen.getByRole("table", { name: "Asiento del gasto" });
  assert.match(asiento.textContent, /El gasto · 31\/10\/26/);
  assert.match(asiento.textContent, /IVA Credito Fiscal/);
  assert.match(asiento.textContent, /Proveedores/);

  fireEvent.click(screen.getByLabelText("Ya está pagado"));
  fireEvent.change(screen.getByLabelText("Se pagó con"), { target: { value: "Caja Principal" } });
  await waitFor(() => assert.match(screen.getByRole("table", { name: "Asiento del gasto" }).textContent, /El pago/));

  fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => assert.equal(enviado.length, 1));
  const g = enviado[0].gasto;
  assert.equal(enviado[0].accion, "gasto");
  assert.deepEqual([g.tipo, String(g.proveedor_id), g.neto, g.iva, g.mes, g.cuenta_caja, g.cuenta_deuda], ["SERVICIOS", "5", 1000, 210, "2026-10", "01.01.01.001.001.01", ""]);
});

test("Movimientos — en una factura B no se pide IVA; sin proveedor se elige dónde queda la deuda", async () => {
  global.fetch = async () => new Response(JSON.stringify({ desde: "2026-11-01", hasta: "2026-11-11", truncado: false, ...CTX, operaciones: [] }), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" })));
  fireEvent.click(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" }));
  fireEvent.click(screen.getByRole("button", { name: "B" }));
  assert.equal(screen.queryByLabelText("IVA"), null);
  assert.ok(screen.getByLabelText("Importe"));
  fireEvent.click(screen.getByRole("button", { name: "Impuesto, servicio u otro" }));
  fireEvent.change(screen.getByLabelText("Tipo de gasto"), { target: { value: "Ingresos Brutos" } });
  assert.equal(screen.getByLabelText("Queda la deuda en").value, "Impuesto IIBB A Pagar");
});

test("Movimientos — un gasto devengado se puede anular desde el detalle (con su pago)", async () => {
  const datos = {
    desde: "2026-11-01", hasta: "2026-11-11", truncado: false, ...CTX,
    operaciones: [{ id: 40, fecha: "2026-10-31", tipo: "SERVICIOS", proveedor_id: 5, neto: 1000, iva: 0, otros_impuestos: 0, total: 1000, total_ars: 1000, moneda: "ARS", cuenta_debe: "04.02.01.001.010", cuenta_haber: "02.01.02.001.001", origen: "gasto", estado: "confirmada" }],
  };
  global.fetch = async () => new Response(JSON.stringify(datos), { status: 200 });
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByText("Servicios · EPEC")));
  fireEvent.click(screen.getByText("Servicios · EPEC"));
  await waitFor(() => assert.ok(screen.getByText("🧾 Gasto devengado", { selector: "span.text-gypi-text" })));
  fireEvent.click(screen.getByRole("button", { name: "Anular operación" }));
  assert.ok(screen.getByText(/Se anula junto con su pago/));
});

// ─── Parte 6: subir la factura ───

const LECTURA = {
  letra: "A", punto_venta: "0003", numero: "00001234", fecha: "2026-11-05", emisor: "Empresa Provincial de Energía de Córdoba", cuit_emisor: "30-99901234-5",
  periodo: "2026-10", neto: 1000, iva: 210, otros_impuestos: 30, total: 1240, moneda: "ARS", concepto: "Energía eléctrica planta", tipo_sugerido: "SERVICIOS",
};
const EPEC = { id: 5, nombre: "EPEC", cuit: "30999012345", activo: true };

test("factura leída — el esquema trae los tipos de gasto para elegir", () => {
  const esq = esquemaGasto(tiposDeGasto(TIPOS, TESORERIA));
  assert.deepEqual(esq.properties.tipo_sugerido.enum, ["SERVICIOS", "IIBB", ""]);
  assert.ok(esq.required.includes("periodo"));
  assert.equal(esq.additionalProperties, false);
});

test("factura leída — el proveedor se encuentra por CUIT o por el nombre en cualquier orden", () => {
  assert.equal(proveedorDeFactura({ emisor: "Otra cosa", cuit: "30-99901234-5" }, [EPEC])?.id, 5);
  assert.equal(proveedorDeFactura({ emisor: "Giri Tadeo" }, [{ id: 7, nombre: "TADEO GIRI" }])?.id, 7);
  assert.equal(proveedorDeFactura({ emisor: "Aceros S.A." }, [{ id: 8, nombre: "ACEROS" }])?.id, 8);
  assert.equal(proveedorDeFactura({ emisor: "Nadie" }, [EPEC]), null);
});

test("factura leída — propuesta: proveedor por CUIT, su tipo guardado, mes del período y avisos", () => {
  const ctx = { ...CTX, proveedores: [{ ...EPEC, fin_tipo: "IIBB" }] };
  const { inicial, avisos, proveedor_nuevo: nuevo } = propuestaDeLectura(LECTURA, ctx);
  assert.equal(nuevo, null);
  assert.deepEqual(
    [inicial.tipo, inicial.proveedor_id, inicial.letra, inicial.punto_venta, inicial.numero, inicial.fecha_factura, inicial.mes, inicial.neto, inicial.iva, inicial.otros_impuestos],
    ["IIBB", "5", "A", "0003", "00001234", "2026-11-05", "2026-10", "1000", "210", "30"],
  );
  assert.ok(avisos.some((a) => /es de 10\/2026: va a ese mes/.test(a)));
  assert.deepEqual(operacionesGasto(inicial, ctx).errores, [], "la propuesta se puede guardar tal cual");

  const sinProv = propuestaDeLectura({ ...LECTURA, cuit_emisor: "", total: 999 }, CTX);
  assert.equal(sinProv.inicial.tipo, "SERVICIOS", "sin proveedor, el tipo que sugiere la IA");
  assert.deepEqual(sinProv.proveedor_nuevo, { nombre: "Empresa Provincial de Energía de Córdoba", cuit: "" });
  assert.ok(sinProv.avisos.some((a) => /no está en tus proveedores/.test(a)));
  assert.ok(sinProv.avisos.some((a) => /no da con neto \+ IVA/.test(a)));
});

test("factura leída — una B con IVA leído lo suma al neto; un ticket va sin factura; en dólares avisa", () => {
  const b = propuestaDeLectura({ ...LECTURA, letra: "B", iva: 210 }, CTX).inicial;
  assert.deepEqual([b.letra, b.neto, b.iva, b.con_factura], ["B", "1210", "", true]);
  const ticket = propuestaDeLectura({ ...LECTURA, letra: "", iva: 0, total: 1030 }, CTX);
  assert.equal(ticket.inicial.con_factura, false);
  assert.ok(propuestaDeLectura({ ...LECTURA, moneda: "USD" }, CTX).avisos.some((a) => /dólares/.test(a)));
  assert.ok(propuestaDeLectura({ ...LECTURA, fecha: "", neto: 0, tipo_sugerido: "" }, CTX).avisos.join(" ").match(/fecha.*importes.*tipo de gasto/));
});

test("/api/finanzas/operaciones leer_gasto — la IA lee la factura con los tipos de la empresa y vuelve la propuesta (no guarda nada)", async () => {
  process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
  const escrito = mockApi({ lectura: LECTURA, repetida: { id: 12, fecha: "2026-10-31" } });
  assert.equal((await pedir("gerencial", { accion: "leer_gasto", archivo: "QUJD", tipo: "text/plain" })).status, 400);
  const res = await pedir("gerencial", { accion: "leer_gasto", archivo: "JVBERi0xLjQK", tipo: "application/pdf" });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.inicial.tipo, "SERVICIOS");
  assert.equal(d.inicial.mes, "2026-10");
  assert.match(d.avisos[0], /ya está cargada/);
  const pedido = escrito.ia[0];
  assert.match(pedido.system, /Tipos de gasto de la empresa:\n- SERVICIOS \(Servicios\)/);
  assert.doesNotMatch(pedido.system, /PAGO TRANSF/, "solo los tipos de gasto");
  assert.deepEqual(pedido.output_config.format.schema.properties.tipo_sugerido.enum, ["SERVICIOS", "IIBB", ""]);
  assert.equal(escrito.filter((x) => x.metodo === "POST" && x.url.includes("fin_operaciones")).length, 0);
  assert.equal((await pedir("administrativo", { accion: "leer_gasto", archivo: "JVBERi0xLjQK", tipo: "application/pdf" })).status, 403);
});

test("/api/finanzas/operaciones proveedor_nuevo — da de alta el proveedor de la factura con su CUIT", async () => {
  const escrito = mockApi();
  const res = await pedir("gerencial", { accion: "proveedor_nuevo", nombre: "  Energía   Córdoba ", cuit: "30999012345" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).proveedor.id, 88);
  const alta = escrito.find((x) => x.url.includes("/proveedores") && x.metodo === "POST");
  assert.deepEqual([alta.body.nombre, alta.body.cuit, alta.body.empresa_id], ["Energía Córdoba", "30-99901234-5", E]);
  assert.equal((await pedir("gerencial", { accion: "proveedor_nuevo", nombre: "" })).status, 400);
});

test("Movimientos — 📎 subir la factura deja la propuesta para revisar y se da de alta el proveedor", async () => {
  const datos = { desde: "2026-11-01", hasta: "2026-11-11", truncado: false, ...CTX, proveedores: [], operaciones: [] };
  const enviado = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") {
      const b = JSON.parse(o.body);
      enviado.push(b);
      if (b.accion === "leer_gasto") {
        return new Response(JSON.stringify({ ok: true, ...propuestaDeLectura({ ...LECTURA, cuit_emisor: "" }, { ...CTX, proveedores: [] }) }), { status: 200 });
      }
      if (b.accion === "proveedor_nuevo") return new Response(JSON.stringify({ ok: true, proveedor: { id: 21, nombre: b.nombre } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasMovimientos />);
  await waitFor(() => assert.ok(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" })));
  fireEvent.click(screen.getByRole("button", { name: "🧾 Cargar gasto o factura" }));
  const archivo = new File([new Uint8Array([37, 80, 68, 70])], "luz.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Subir la factura"), { target: { files: [archivo] } });
  await waitFor(() => assert.ok(screen.getByText(/Esta es la propuesta de Gypi/)));
  assert.equal(enviado[0].accion, "leer_gasto");
  assert.equal(enviado[0].tipo, "application/pdf");
  assert.ok(enviado[0].archivo.length > 0);
  assert.equal(screen.getByLabelText("Neto (sin IVA)").value, "1000");
  assert.equal(screen.getByLabelText("Mes del gasto").value, "2026-10");
  assert.match(screen.getByLabelText("Avisos de la factura").textContent, /no está en tus proveedores/);

  fireEvent.click(screen.getByRole("button", { name: /Dar de alta a Empresa Provincial/ }));
  await waitFor(() => assert.equal(screen.getByLabelText("Proveedor del gasto").value, "Empresa Provincial de Energía de Córdoba"));
  assert.doesNotMatch(screen.getByLabelText("Avisos de la factura").textContent, /no está en tus proveedores/);
  fireEvent.change(screen.getByLabelText("Centro de costo (obligatorio)"), { target: { value: "PLANTA" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => assert.equal(enviado.at(-1).accion, "gasto"));
  assert.deepEqual([String(enviado.at(-1).gasto.proveedor_id), enviado.at(-1).gasto.tipo, enviado.at(-1).gasto.mes], ["21", "SERVICIOS", "2026-10"]);
});
