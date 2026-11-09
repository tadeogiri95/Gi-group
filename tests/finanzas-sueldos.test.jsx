// tests/finanzas-sueldos.test.jsx — Finanzas, parte F5b: la liquidación de
// sueldos que se pasa a Gypi (calculada afuera), su devengado en el libro
// (DEVENG SUELDO contra Sueldos A Pagar) y los pagos (PAGO SUELDO).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  codigoConcepto, leerConfigSueldos, validarConfigSueldos, numeroSueldo, emparejarEmpleado, renglonesDePegado, validarLiquidacion,
  totalesLiquidacion, operacionesLiquidacion, pagadoPorEmpleado, operacionPagoSueldo, cuentaSueldosAPagar, cuentasDeArea,
} from "../app/lib/finanzasSueldos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/sueldos/route.js");
const { default: FinanzasSueldos } = await import("../app/components/FinanzasSueldos.jsx");

const E = "88888888-8888-8888-8888-888888888888";
const EMP = "99999999-9999-9999-9999-999999999999";
const PROD = "04.02.01.007.001";
const ADM = "04.02.01.007.002";
const HEX = "04.02.01.007.010";
const SAC = "04.02.01.007.020";
const APAGAR = "02.01.03.001.001";
const BANCO = "01.01.01.003.002";
const CUENTAS = [
  { codigo: PROD, nombre: "Sueldos, Jornales y Contribuciones" },
  { codigo: ADM, nombre: "Sueldos, Jornales y Contribuciones Administración" },
  { codigo: HEX, nombre: "Horas extras Producción" },
  { codigo: "04.02.01.007.011", nombre: "Bonos, premios e incentivos" },
  { codigo: "04.02.01.007.012", nombre: "Vacaciones Producción" },
  { codigo: SAC, nombre: "S.a.c." },
  { codigo: APAGAR, nombre: "Sueldos A Pagar" },
  { codigo: BANCO, nombre: "Banco Credicoop" },
];
const EMPLEADOS = [
  { id: "e1", nombre: "Juan Pérez", legajo: 12, activo: true },
  { id: "e2", nombre: "María Gómez", legajo: 15, activo: true },
];

// ─── Reglas ───

test("conceptos de siempre con su cuenta por nombre, y los que se suman", () => {
  const { conceptos } = leerConfigSueldos(null, CUENTAS);
  assert.deepEqual(conceptos.map((c) => c.nombre), ["Sueldo básico", "Presentismo", "Horas Extra", "Bonos", "Horas trabajadas", "Horas Extra trabajadas", "Vacaciones", "S.A.C"]);
  const por = Object.fromEntries(conceptos.map((c) => [c.codigo, c]));
  assert.deepEqual([por.basico.cuenta, por.horas_extra.cuenta, por.sac.cuenta, por.horas_trabajadas.clase], [PROD, HEX, SAC, "horas"]);
  assert.equal(cuentaSueldosAPagar(CUENTAS), APAGAR);
  assert.deepEqual(cuentasDeArea(CUENTAS).map((c) => c.codigo), [PROD, ADM]);
  assert.equal(codigoConcepto("Bonos por Producción"), "bonos_por_produccion");

  const { valor, errores } = validarConfigSueldos({ conceptos: [...conceptos, { nombre: "Remuneraciones Adicionales", clase: "importe", cuenta: PROD }], areas: { e2: ADM } }, CUENTAS);
  assert.deepEqual(errores, []);
  const leido = leerConfigSueldos(valor, CUENTAS);
  assert.equal(leido.conceptos.at(-1).codigo, "remuneraciones_adicionales");
  assert.equal(leido.areas.e2, ADM);
  assert.ok(validarConfigSueldos({ conceptos: [{ nombre: "X", cuenta: "no-existe" }] }, CUENTAS).errores.length);
  assert.ok(validarConfigSueldos({ conceptos: [{ nombre: "X" }, { nombre: "x" }] }, CUENTAS).errores.length, "repetido");
});

test("números a la argentina y empleados por legajo o nombre", () => {
  assert.equal(numeroSueldo("1.234.567,50"), 1234567.5);
  assert.equal(numeroSueldo("850000"), 850000);
  assert.equal(numeroSueldo("-5.000"), -5000);
  assert.equal(numeroSueldo("12,5"), 12.5);
  assert.equal(numeroSueldo(""), null);
  assert.equal(emparejarEmpleado("15", EMPLEADOS).id, "e2");
  assert.equal(emparejarEmpleado("PEREZ JUAN", EMPLEADOS).id, "e1");
  assert.equal(emparejarEmpleado("maria gomez", EMPLEADOS).id, "e2");
  assert.equal(emparejarEmpleado("Nadie", EMPLEADOS), null);
});

test("pegar desde Excel: títulos = conceptos, avisa lo que no encuentra", () => {
  const { conceptos } = leerConfigSueldos(null, CUENTAS);
  const texto = "Empleado\tSueldo básico\tPresentismo\tHoras trabajadas\tNeto\tOtra cosa\nPérez Juan\t850.000,00\t85.000\t176\t935000\t1\nFulano\t1\t1\t1\t1\t1\n";
  const r = renglonesDePegado(texto, conceptos, EMPLEADOS);
  assert.deepEqual(r.renglones, [{ empleado_id: "e1", nombre: "Juan Pérez", valores: { basico: 850000, presentismo: 85000, horas_trabajadas: 176 } }]);
  assert.deepEqual(r.sin_empleado, ["Fulano"]);
  assert.deepEqual(r.sin_concepto, ["Otra cosa"], "Neto no avisa");
  assert.ok(renglonesDePegado("solo una fila", conceptos, EMPLEADOS).error);
});

test("devengado: un DEVENG SUELDO por importe, al área del empleado, horas fuera, descuento al revés", () => {
  const { conceptos } = leerConfigSueldos(null, CUENTAS);
  const { liquidacion, errores } = validarLiquidacion({
    periodo: "Octubre 2026", fecha: "2026-11-05",
    renglones: [
      { empleado_id: "e1", valores: { basico: "850.000", horas_trabajadas: "176", horas_extra: "40000", bonos: "-5000" } },
      { empleado_id: "e2", valores: { basico: 900000, sac: 0 } },
    ],
  }, { conceptos, empleados: EMPLEADOS });
  assert.deepEqual(errores, []);
  assert.deepEqual(liquidacion.renglones[1].valores, { basico: 900000 }, "sin ceros");
  const liq = { ...liquidacion, id: 7 };
  const tot = totalesLiquidacion(liq, conceptos);
  assert.deepEqual(tot.porEmpleado.map((e) => [e.empleado_id, e.total, e.horas]), [["e1", 885000, 176], ["e2", 900000, 0]]);
  assert.equal(tot.total, 1785000);

  const { ops, errores: e2 } = operacionesLiquidacion(liq, { conceptos, areas: { e2: ADM }, cuentaAPagar: APAGAR });
  assert.deepEqual(e2, []);
  assert.deepEqual(ops.map((o) => [o.tipo, o.cuenta_debe, o.cuenta_haber, o.total, o.origen_id]), [
    ["DEVENG SUELDO", PROD, APAGAR, 850000, "l7:e1:basico"],
    ["DEVENG SUELDO", HEX, APAGAR, 40000, "l7:e1:horas_extra"],
    ["DEVENG SUELDO", APAGAR, "04.02.01.007.011", 5000, "l7:e1:bonos"],
    ["DEVENG SUELDO", ADM, APAGAR, 900000, "l7:e2:basico"],
  ]);
  assert.equal(ops[0].descripcion, "Sueldo básico · Octubre 2026 · Juan Pérez");
  assert.equal(ops[0].origen, "liquidacion");
  assert.ok(operacionesLiquidacion(liq, { conceptos, cuentaAPagar: null }).errores.length, "sin Sueldos A Pagar");
  assert.ok(validarLiquidacion({ periodo: "", fecha: "x", renglones: [{ empleado_id: "otro" }] }, { conceptos, empleados: EMPLEADOS }).errores.length >= 3);
});

test("pagos: Sueldos A Pagar contra la caja, y lo pagado por empleado", () => {
  const liq = { id: 7, periodo: "Octubre 2026" };
  const op = operacionPagoSueldo({ liq, renglon: { empleado_id: "e1", nombre: "Juan Pérez" }, caja: { cuenta: BANCO }, importe: 500000, fecha: "2026-11-06", n: 1 }, APAGAR);
  assert.deepEqual([op.tipo, op.cuenta_debe, op.cuenta_haber, op.total, op.origen, op.origen_id], ["PAGO SUELDO", APAGAR, BANCO, 500000, "pago_sueldo", "l7:e1:1"]);
  const pagado = pagadoPorEmpleado(7, [op, { ...op, origen_id: "l7:e1:2", total_ars: 100 }, { ...op, origen_id: "l7:e1:3", anulada_at: "x" }, { ...op, origen_id: "l70:e1:1" }]);
  assert.deepEqual(pagado, { e1: 500100 });
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/sueldos", {
  method: "POST", headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

function mockApi({ liquidacion = null, pagos = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?") && u.includes(`id=eq.${EMP}`), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: EMPLEADOS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO, nombre: "Credicoop", tipo: "banco", moneda: "ARS" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { escrito.push({ tabla: "config_sistema", metodo: o.method, body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        return { status: 200, body: [{ valor: { conceptos: [], areas: { e2: ADM } } }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_liquidaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { const b = JSON.parse(o.body); escrito.push({ tabla: "fin_liquidaciones", metodo: "POST", body: b }); return { status: 201, body: [{ ...b, id: 9 }] }; }
        if (o?.method === "PATCH") { const b = JSON.parse(o.body); escrito.push({ tabla: "fin_liquidaciones", metodo: "PATCH", url: u, body: b }); return { status: 200, body: liquidacion ? [{ ...liquidacion, ...b }] : [] }; }
        return { status: 200, body: liquidacion ? [liquidacion] : [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push({ tabla: "fin_operaciones", metodo: "POST", body: JSON.parse(o.body) }); return { status: 201, body: [] }; }
        if (o?.method === "PATCH") { escrito.push({ tabla: "fin_operaciones", metodo: "PATCH", url: decodeURIComponent(u), body: JSON.parse(o.body) }); return { status: 200, body: [{ id: 1 }] }; }
        return { status: 200, body: pagos };
      },
    },
  ]);
  return escrito;
}

const LIQ = {
  id: 7, empresa_id: E, periodo: "Octubre 2026", fecha: "2026-11-05", estado: "borrador",
  renglones: [{ empleado_id: "e1", nombre: "Juan Pérez", valores: { basico: 850000, horas_trabajadas: 176 } }, { empleado_id: "e2", nombre: "María Gómez", valores: { basico: 900000 } }],
};

test("/api/finanzas/sueldos — solo el Dueño", async () => {
  const escrito = mockApi();
  for (const rol of ["administrativo", "operativo"]) assert.equal((await pedir(rol, { accion: "guardar" })).status, 403, rol);
  assert.equal(escrito.length, 0);
});

test("/api/finanzas/sueldos — guardar una liquidación nueva en borrador", async () => {
  const escrito = mockApi();
  const r = await pedir("gerencial", { accion: "guardar", periodo: "Octubre 2026", fecha: "2026-11-05", renglones: [{ empleado_id: "e1", valores: { basico: "850.000,00" } }] });
  assert.equal(r.status, 200);
  const g = escrito.find((x) => x.tabla === "fin_liquidaciones").body;
  assert.deepEqual([g.estado, g.empresa_id, g.cargada_por_nombre, g.renglones[0].valores.basico], ["borrador", E, "Tadeo", 850000]);
  assert.equal((await pedir("gerencial", { accion: "guardar", periodo: "X", fecha: "2026-11-05", renglones: [{ empleado_id: "de-otra" }] })).status, 400);
});

test("/api/finanzas/sueldos — confirmar: marca la liquidación y anota el devengado", async () => {
  const escrito = mockApi({ liquidacion: LIQ });
  const r = await pedir("gerencial", { accion: "confirmar", id: 7 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).operaciones, 2);
  const patch = escrito.find((x) => x.tabla === "fin_liquidaciones" && x.metodo === "PATCH");
  assert.match(patch.url, /estado=eq\.borrador/, "dos clics no devengan dos veces");
  const ops = escrito.find((x) => x.tabla === "fin_operaciones").body;
  assert.deepEqual(ops.map((o) => [o.cuenta_debe, o.cuenta_haber, o.total, o.empresa_id]), [[PROD, APAGAR, 850000, E], [ADM, APAGAR, 900000, E]]);
});

test("/api/finanzas/sueldos — pagar: no más de lo que falta, desde un banco de la empresa", async () => {
  const conf = { ...LIQ, estado: "confirmada" };
  const ya = [{ id: 50, origen: "pago_sueldo", origen_id: "l7:e1:1", total_ars: 800000, total: 800000 }];
  let escrito = mockApi({ liquidacion: conf, pagos: ya });
  assert.equal((await pedir("gerencial", { accion: "pagar", id: 7, pagos: [{ empleado_id: "e1", importe: 60000, cuenta: BANCO, fecha: "2026-11-06" }] })).status, 400, "falta 50.000");
  assert.equal((await pedir("gerencial", { accion: "pagar", id: 7, pagos: [{ empleado_id: "e2", importe: 900000, cuenta: "otra", fecha: "2026-11-06" }] })).status, 400, "caja de otra empresa");
  escrito = mockApi({ liquidacion: conf, pagos: ya });
  const r = await pedir("gerencial", { accion: "pagar", id: 7, pagos: [{ empleado_id: "e1", importe: 50000, cuenta: BANCO, fecha: "2026-11-06" }, { empleado_id: "e2", importe: 900000, cuenta: BANCO, fecha: "2026-11-06" }] });
  assert.equal(r.status, 200);
  const ops = escrito.find((x) => x.tabla === "fin_operaciones").body;
  assert.deepEqual(ops.map((o) => [o.tipo, o.cuenta_debe, o.cuenta_haber, o.total, o.origen_id]), [["PAGO SUELDO", APAGAR, BANCO, 50000, "l7:e1:2"], ["PAGO SUELDO", APAGAR, BANCO, 900000, "l7:e2:1"]]);
});

test("/api/finanzas/sueldos — anular: no con pagos vivos; sin pagos anula el devengado", async () => {
  const conf = { ...LIQ, estado: "confirmada" };
  mockApi({ liquidacion: conf, pagos: [{ id: 50, origen: "pago_sueldo", origen_id: "l7:e1:1", total: 1 }] });
  assert.equal((await pedir("gerencial", { accion: "anular", id: 7 })).status, 400);
  const escrito = mockApi({ liquidacion: conf, pagos: [] });
  assert.equal((await pedir("gerencial", { accion: "anular", id: 7 })).status, 200);
  const op = escrito.find((x) => x.tabla === "fin_operaciones" && x.metodo === "PATCH");
  assert.match(op.url, /origen=eq\.liquidacion&origen_id=like\.l7:\*/);
  assert.ok(op.body.anulada_at);
});

// ─── Pantalla ───

test("Sueldos — pegar desde Excel arma la grilla y la guarda", async () => {
  const { conceptos, areas } = leerConfigSueldos(null, CUENTAS);
  const datos = { conceptos, areas, config_guardada: true, cuentas: CUENTAS, cuentas_area: cuentasDeArea(CUENTAS), cuenta_a_pagar: APAGAR, empleados: EMPLEADOS, tesoreria: [], liquidaciones: [], pagos: [] };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (!o.method || o.method === "GET") return new Response(JSON.stringify(datos), { status: 200 });
    const b = JSON.parse(o.body);
    enviados.push(b);
    return new Response(JSON.stringify({ ok: true, liquidacion: { id: 1 } }), { status: 200 });
  };
  render(<FinanzasSueldos />);
  fireEvent.click(await screen.findByRole("button", { name: "+ Liquidación" }));
  fireEvent.click(screen.getByRole("button", { name: "📋 Pegar desde Excel" }));
  fireEvent.change(screen.getByLabelText("Tabla pegada"), { target: { value: "Legajo\tSueldo básico\tHoras trabajadas\n12\t850.000\t176\n15\t900.000\t180" } });
  assert.ok(screen.getByText(/Encontré/));
  fireEvent.click(screen.getByRole("button", { name: "Usar estos datos" }));
  assert.equal(screen.getByLabelText("Sueldo básico de María Gómez").value, "900000");
  assert.ok(screen.getAllByText("$ 1.750.000,00").length >= 1, "total de la liquidación");
  fireEvent.change(screen.getByLabelText("Período"), { target: { value: "Octubre 2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].periodo, enviados[0].renglones.length, enviados[0].renglones[0].valores.basico], ["guardar", "Octubre 2026", 2, "850000"]);
});
