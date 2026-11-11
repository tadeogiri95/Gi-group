// tests/finanzas-plazos-fijos.test.jsx — Finanzas, parte 8 del plan del
// 11/11: plazos fijos con el interés aparte, importados de la planilla del
// banco (.xls del Credicoop) sin repetir. También el lector de .xls.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { xlsFalso } from "./helpers/xlsFalso.js";
import { fechaDeSerie, hojasXls, leerHojaXls } from "../app/lib/leerXls.js";
import { grillaDeArchivo } from "../app/lib/finanzasExtracto.js";
import {
  contextoPlazos, cuentasPorDefecto, estadoDePlazos, interesesPorCobrar, leerPlazosFijos, listaPlazos,
  planPlazosFijos, unirPlazos, vencidosPendientes,
} from "../app/lib/finanzasPlazosFijos.js";
import { flujoPrevisto } from "../app/lib/finanzasFlujo.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/plazos-fijos/route.js");
const { default: FinanzasPlazosFijos } = await import("../app/components/FinanzasPlazosFijos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PF = "01.01.01.006.001";
const BANCO = "01.01.01.003.002";
const INTERESES = "04.01.02.002.001";
const TESORERIA = [
  { cuenta: PF, nombre: "PLAZO FIJO BCO CREDICOOP", tipo: "plazo_fijo", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.006.002", nombre: "PLAZO FIJO BCO ICBC", tipo: "plazo_fijo", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.003.001", nombre: "BANCO ICBC CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: BANCO, nombre: "BANCO CREDICOOP CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.001.001", nombre: "Caja", tipo: "caja", moneda: "ARS", activa: true },
];
const TIPOS = [
  { codigo: "PLAZO FIJO", cuenta_debe: null, cuenta_haber: null, activo: true },
  { codigo: "RENDIMIENTOS FINANCIEROS", cuenta_debe: BANCO, cuenta_haber: INTERESES, activo: true },
];
const CUENTAS = [{ codigo: INTERESES, nombre: "Intereses Ganados", activa: true }];

// La planilla como la baja el Credicoop (Plazos Fijos Vigentes), con datos inventados
const CELDAS = [
  [0, 1, "Plazos Fijos Vigentes"], [0, 6, "29/10/2026 - 12:50"],
  [1, 1, "Adherente"], [1, 2, "999999   EMPRESA DE PRUEBA SRL "],
  [5, 1, "Tipo Plazo Fijo"], [5, 3, "Moneda"], [5, 4, "Nro de \nCertificado"], [5, 5, "Monto Depositado"], [5, 7, "Vencimiento"], [5, 8, "Monto a \nreembolsar"],
  [7, 1, "Pesos Intransferible Tradicional Persona Juridica"], [7, 3, "ARS"], [7, 4, "10000001"], [7, 5, "1.000.000,00"], [7, 7, "02/11/2026"], [7, 8, "1.040.000,50"],
  [8, 1, "Pesos Intransferible Tradicional Persona Juridica"], [8, 3, "ARS"], [8, 4, "10000002"], [8, 5, "2.000.000,00"], [8, 7, "03/11/2026"], [8, 8, "2.080.000,00"],
  [9, 1, "Pesos Intransferible Tradicional Persona Juridica"], [9, 3, "ARS"], [9, 4, "10000003"], [9, 5, "500.000,00"], [9, 7, "24/12/2026"], [9, 8, "520.000,00"],
  [10, 1, "Dólares Intransferible"], [10, 3, "USD"], [10, 4, "10000004"], [10, 5, "1.000,00"], [10, 7, "26/11/2026"], [10, 8, "1.010,00"],
  [11, 1, "Pesos"], [11, 3, "ARS"], [11, 4, "10000005"], [11, 5, ""], [11, 7, "26/11/2026"], [11, 8, "5,00"],
  [12, 1, "Banco Credicoop Cooperativo Ltdo. Derechos Reservados 2004"],
];

// ─── Lector de .xls ───

test("leerXls — lee textos (SST y sueltos), números y acentos; en sectores comunes y en el mini stream", () => {
  const celdas = [[0, 0, "Año ñandú €"], [0, 2, 1234.56], [1, 1, 42], [1, 3, -7], [2, 0, "Nro de \nCertificado"]];
  for (const chico of [false, true]) {
    for (const textosSueltos of [false, true]) {
      const b = xlsFalso({ hoja: "Vigentes", celdas, chico, textosSueltos });
      assert.deepEqual(hojasXls(b), ["Vigentes"]);
      assert.deepEqual(leerHojaXls(b), [["Año ñandú €", "", "1234.56"], ["", "42", "", "-7"], ["Nro de \nCertificado"]], `chico=${chico} sueltos=${textosSueltos}`);
    }
  }
  assert.equal(leerHojaXls(xlsFalso({ hoja: "A", celdas }), "Otra"), null);
  assert.throws(() => leerHojaXls(new Uint8Array(1024)), /No es un Excel .xls/);
  assert.equal(fechaDeSerie(46328), "2026-11-02");
  assert.equal(fechaDeSerie("x"), null);
});

test("grillaDeArchivo — .xls, CSV y PDF (null)", async () => {
  const g = await grillaDeArchivo(xlsFalso({ hoja: "pf", celdas: CELDAS }));
  assert.equal(g[7][4], "10000001");
  const csv = await grillaDeArchivo(new TextEncoder().encode("Nro de Certificado;Monto Depositado;Vencimiento\n1;2;3\n"));
  assert.deepEqual(csv[1], ["1", "2", "3"]);
  assert.equal(await grillaDeArchivo(new TextEncoder().encode("%PDF-1.4 ...")), null);
});

// ─── La planilla del banco ───

test("leerPlazosFijos — columnas del Credicoop, interés = a reembolsar − depositado, fecha en que se bajó", async () => {
  const r = leerPlazosFijos(await grillaDeArchivo(xlsFalso({ hoja: "plazosFijosVigentesExport", celdas: CELDAS })));
  assert.equal(r.exportado, "2026-10-29");
  assert.deepEqual(r.plazos.map((p) => [p.certificado, p.moneda, p.depositado, p.interes, p.vencimiento]), [
    ["10000001", "ARS", 1000000, 40000.5, "2026-11-02"],
    ["10000002", "ARS", 2000000, 80000, "2026-11-03"],
    ["10000003", "ARS", 500000, 20000, "2026-12-24"],
    ["10000004", "USD", 1000, 10, "2026-11-26"],
  ]);
  assert.match(r.avisos.join(" "), /10000005 no tiene bien el monto/);
  assert.match(leerPlazosFijos([["Fecha", "Importe"], ["1/1/2026", "5"]]).error, /No encontré las columnas/);
  // Con una columna de interés y sin "a reembolsar", y la fecha como número de Excel
  const otra = leerPlazosFijos([["Certificado", "Capital", "Vencimiento", "Interés"], ["555 123", "100,00", "46328", "3,50"], ["555123", "1", "46328", "1"]]);
  assert.deepEqual(otra.plazos.map((p) => [p.certificado, p.reembolsar, p.vencimiento]), [["555123", 103.5, "2026-11-02"]], "el repetido no entra");
});

test("cuentasPorDefecto — la cuenta de plazo fijo del banco del archivo y el banco que comparte el nombre", () => {
  assert.deepEqual(cuentasPorDefecto(TESORERIA, "Banco Credicoop Cooperativo Ltdo."), { cuenta_pf: PF, banco: BANCO });
  assert.deepEqual(cuentasPorDefecto(TESORERIA, "ICBC"), { cuenta_pf: "01.01.01.006.002", banco: "01.01.01.003.001" });
  assert.deepEqual(cuentasPorDefecto(TESORERIA, ""), { cuenta_pf: "", banco: "" });
});

test("contextoPlazos — tipos nuevos o viejos, Intereses Ganados, y lo que falta", () => {
  const { ctx } = contextoPlazos({ tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, banco: BANCO, cuenta_pf: PF });
  assert.deepEqual([ctx.tipo_c, ctx.tipo_r, ctx.tipo_i, ctx.cuenta_interes], ["PLAZO FIJO", "PLAZO FIJO", "RENDIMIENTOS FINANCIEROS", INTERESES]);
  const viejos = contextoPlazos({
    tipos: [{ codigo: "CONSTITUCIÓN PLAZO FIJO" }, { codigo: "RESCATE PLAZO FIJO" }, { codigo: "COBRO RENDIMIENTOS FINANCIEROS", cuenta_haber: "01.01.01.001.001" }],
    cuentas: CUENTAS, tesoreria: TESORERIA, banco: BANCO, cuenta_pf: PF,
  }).ctx;
  assert.deepEqual([viejos.tipo_c, viejos.tipo_r, viejos.tipo_i, viejos.cuenta_interes], ["CONSTITUCIÓN PLAZO FIJO", "RESCATE PLAZO FIJO", "COBRO RENDIMIENTOS FINANCIEROS", INTERESES], "si el tipo no va contra un ingreso, Intereses Ganados por nombre");
  const mal = contextoPlazos({ tipos: [], cuentas: [], tesoreria: TESORERIA, banco: BANCO, cuenta_pf: BANCO });
  assert.match(mal.errores.join(" "), /Elegí la cuenta del plazo fijo.*PLAZO FIJO.*RENDIMIENTOS FINANCIEROS.*Intereses Ganados/);
});

// ─── Qué se carga ───

const CTX = contextoPlazos({ tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, banco: BANCO, cuenta_pf: PF }).ctx;
const plazo = (certificado, depositado, interes, vencimiento, extra = {}) => ({ certificado, tipo: "", moneda: "ARS", depositado, reembolsar: depositado + interes, interes, vencimiento, constituido: null, ...extra });
const P1 = plazo("10000001", 1000000, 40000.5, "2026-11-02");
const P2 = plazo("10000002", 2000000, 80000, "2026-11-03");
const P3 = plazo("10000003", 500000, 20000, "2026-12-24");
// Lo que ya está en Gypi, copiado del libro: la constitución del 1 y su interés (sin descripción)
const DEL_LIBRO = [
  { id: 1, fecha: "2026-08-03", tipo: "CONSTITUCIÓN PLAZO FIJO", total: 1000000, cuenta_debe: PF, cuenta_haber: BANCO, descripcion: "Constitucion de Plazo Fijo (Exento) Operacion: 10000001 - Circular: 037", origen: "libro" },
  { id: 2, fecha: "2026-11-02", tipo: "COBRO RENDIMIENTOS FINANCIEROS", total: 40000.5, cuenta_debe: BANCO, cuenta_haber: INTERESES, descripcion: "", origen: "libro" },
  { id: 3, fecha: "2026-11-02", tipo: "COBRO RENDIMIENTOS FINANCIEROS", total: 40000.5, cuenta_debe: BANCO, cuenta_haber: INTERESES, descripcion: "", origen: "libro", anulada_at: "2026-11-05" },
];

test("planPlazosFijos — no repite lo del libro; los nuevos con su constitución y, si vencieron, vencimiento e interés aparte", () => {
  const plan = planPlazosFijos({ plazos: [P1, P2, P3, plazo("10000004", 1000, 10, "2026-11-26", { moneda: "USD" })], ops: DEL_LIBRO, ctx: CTX, cuentasPf: [PF], hoy: "2026-11-11", fechaPorDefecto: "2026-10-29", fechas: { 10000003: "2026-10-20" } });
  const por = Object.fromEntries(plan.filas.map((f) => [f.plazo.certificado, f]));
  assert.equal(por["10000001"].estado, "vencido");
  assert.deepEqual(por["10000001"].ya, ["constitución", "interés"]);
  assert.deepEqual(por["10000001"].ops.map((o) => [o.origen_id, o.fecha, o.cuenta_debe, o.cuenta_haber, o.total]), [["pf10000001:r", "2026-11-02", BANCO, PF, 1000000]], "solo falta que vuelva al banco");
  assert.deepEqual(por["10000002"].ops.map((o) => [o.origen_id, o.tipo, o.fecha, o.cuenta_debe, o.cuenta_haber, o.total]), [
    ["pf10000002:c", "PLAZO FIJO", "2026-10-29", PF, BANCO, 2000000],
    ["pf10000002:r", "PLAZO FIJO", "2026-11-03", BANCO, PF, 2000000],
    ["pf10000002:i", "RENDIMIENTOS FINANCIEROS", "2026-11-03", BANCO, INTERESES, 80000],
  ], "el interés va el día que vence, aparte");
  assert.deepEqual(por["10000003"].ops.map((o) => [o.origen_id, o.fecha]), [["pf10000003:c", "2026-10-20"]], "todavía no venció; con la fecha elegida");
  assert.match(por["10000003"].ops[0].descripcion, /Operacion: 10000003 · vence 24\/12\/2026/);
  assert.equal(por["10000003"].ops[0].origen, "plazo_fijo");
  assert.equal(por["10000004"].estado, "dolares");
  assert.equal(plan.ops.length, 5);
  const omitido = planPlazosFijos({ plazos: [P2], ops: [], ctx: CTX, hoy: "2026-11-11", omitir: ["10000002"] });
  assert.deepEqual(omitido.ops, []);
});

test("planPlazosFijos — lo cargado por Gypi se reconoce por su clave; la segunda vez no hay nada para cargar", () => {
  const primera = planPlazosFijos({ plazos: [P2], ops: [], ctx: CTX, hoy: "2026-11-11" });
  const ya = primera.ops.map((o, i) => ({ ...o, id: 100 + i }));
  const segunda = planPlazosFijos({ plazos: [P2], ops: ya, ctx: CTX, hoy: "2026-11-11" });
  assert.equal(segunda.filas[0].estado, "cargado");
  assert.deepEqual(segunda.ops, []);
  // El mismo interés para dos plazos: cada operación sirve para uno solo
  const e = estadoDePlazos([plazo("1111", 100, 5, "2026-11-02"), plazo("2222", 100, 5, "2026-11-02")], [{ id: 9, fecha: "2026-11-03", tipo: "RENDIMIENTOS FINANCIEROS", total: 5, descripcion: "" }], [PF]);
  assert.ok(e.get("1111").i);
  assert.equal(e.get("2222").i, null);
});

test("vencidos, lista e intereses para el flujo", () => {
  const guardados = [P1, P2, P3].map((p) => ({ ...p, banco: BANCO, cuenta_pf: PF }));
  const ops = [...DEL_LIBRO, { id: 7, fecha: "2026-10-29", tipo: "PLAZO FIJO", total: 2000000, cuenta_debe: PF, cuenta_haber: BANCO, descripcion: "x", origen: "plazo_fijo", origen_id: "pf10000002:c" }];
  const pend = vencidosPendientes(guardados, ops, [PF], "2026-11-11");
  assert.deepEqual(pend.map((p) => [p.certificado, p.falta]), [["10000001", { r: true, i: false }], ["10000002", { r: true, i: true }]]);
  const lista = listaPlazos(guardados, ops, [PF], "2026-11-11");
  assert.deepEqual(lista.map((p) => p.situacion), ["vencido", "vencido", "sin_cargar"]);
  const terminado = listaPlazos(guardados, [...ops, { id: 8, fecha: "2026-11-02", total: 1000000, cuenta_debe: BANCO, cuenta_haber: PF, descripcion: "Vencimiento Plazo Fijo (Exento) Operacion: 10000001", origen: "libro" }], [PF], "2026-11-11");
  assert.equal(terminado[0].situacion, "terminado");
  const intereses = interesesPorCobrar(lista, "2026-11-11");
  assert.deepEqual(intereses.map((x) => [x.fecha, x.importe]), [["2026-11-11", 40000.5], ["2026-11-11", 80000]], "lo vencido sin registrar entra hoy");
  const flujo = flujoPrevisto({ hoy: "2026-11-11", saldoHoy: 0, intereses: [{ fecha: "2026-11-25", importe: 20000, detalle: "PF" }] });
  const fila = flujo.filas.find((f) => f.id === "intereses");
  assert.equal(fila.nombre, "Intereses de plazos fijos");
  assert.deepEqual(fila.valores.slice(0, 3), [0, 0, 20000]);
  assert.equal(flujo.saldo[2], 20000);
});

test("unirPlazos — por certificado, sin repetir; lo nuevo pisa a lo viejo", () => {
  const u = unirPlazos([{ ...P1, banco: BANCO }, P3], [{ ...P1, interes: 1 }, P2]);
  assert.deepEqual(u.map((p) => p.certificado), ["10000003", "10000002", "10000001"]);
  assert.equal(u.find((p) => p.certificado === "10000001").interes, 1);
  assert.equal(u.find((p) => p.certificado === "10000001").banco, BANCO);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/plazos-fijos", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi() {
  const insertado = [];
  const config = { filas: [] };
  const tabla = { fin_tesoreria: TESORERIA, fin_tipos_operacion: TIPOS, fin_cuentas: CUENTAS, empleados: [{ nombre: "Tadeo" }] };
  const ops = [...DEL_LIBRO.filter((o) => !o.anulada_at)];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") { config.filas = [{ valor: JSON.parse(o.body).valor }]; config.escrituras = (config.escrituras || 0) + 1; return { status: 201, body: [{}] }; }
        return { status: 200, body: config.filas };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") {
          const filas = JSON.parse(o.body);
          filas.forEach((f, i) => { insertado.push(f); ops.push({ ...f, id: 500 + ops.length + i }); });
          return { status: 201, body: filas };
        }
        return { status: 200, body: ops };
      },
    },
    { match: (u) => /\/rest\/v1\/(fin_|empleados)/.test(u), respond: (u) => ({ status: 200, body: tabla[u.split("/rest/v1/")[1].split("?")[0]] || [] }) },
  ]);
  return { insertado, config };
}

test("/api/finanzas/plazos-fijos — solo el Dueño; ver, cargar sin repetir y registrar los vencidos", async () => {
  const { insertado, config } = mockApi();
  assert.equal((await pedir("administrativo", "GET")).status, 403);
  const g = await (await pedir("gerencial", "GET")).json();
  assert.deepEqual(g.plazos, []);
  assert.deepEqual(g.cuentas_pf.map((t) => t.cuenta), [PF, "01.01.01.006.002"]);
  assert.equal(g.bancos.length, 2, "la caja no es un banco");

  const plazos = [P1, P2, P3];
  assert.equal((await pedir("gerencial", "POST", { accion: "ver", plazos, banco: BANCO, cuenta_pf: "" })).status, 400);
  const ver = await (await pedir("gerencial", "POST", { accion: "ver", plazos, banco: BANCO, cuenta_pf: PF, exportado: "2026-10-29" })).json();
  assert.equal(ver.filas.length, 3);
  assert.equal(insertado.length, 0, "ver no carga nada");

  const futuro = await pedir("gerencial", "POST", { accion: "cargar", plazos: [plazo("10000009", 100, 1, "2099-12-31")], banco: BANCO, cuenta_pf: PF, fechas: { 10000009: "2099-01-01" } });
  assert.equal(futuro.status, 400);

  const ok = await (await pedir("gerencial", "POST", { accion: "cargar", plazos, banco: BANCO, cuenta_pf: PF, exportado: "2026-10-29", omitir: ["10000003"] })).json();
  assert.ok(ok.ok);
  assert.ok(insertado.every((o) => o.origen === "plazo_fijo" && o.empresa_id === E && o.cargada_por_nombre === "Tadeo"));
  assert.ok(!insertado.some((o) => o.referencia === "10000003"), "el destildado no se carga");
  assert.deepEqual(config.filas[0].valor.plazos.map((p) => [p.certificado, p.banco, p.cuenta_pf]), [["10000002", BANCO, PF], ["10000001", BANCO, PF]]);

  const antes = insertado.length;
  const otra = await (await pedir("gerencial", "POST", { accion: "cargar", plazos: [P1, P2], banco: BANCO, cuenta_pf: PF })).json();
  assert.equal(otra.cargadas, 0, "la misma planilla otra vez no repite nada");
  assert.equal(insertado.length, antes);
  assert.equal(config.escrituras, 2, "la segunda vez la lista se actualiza (no se agrega otra)");

  const vencidos = await (await pedir("gerencial", "POST", { accion: "vencidos" })).json();
  assert.equal(vencidos.cargadas, 0, "ya se registraron al cargar");
  assert.equal((await pedir("gerencial", "POST", { accion: "otra" })).status, 400);
});

// ─── Pantalla ───

test("Plazos fijos — lista, aviso de vencidos e importar la planilla del banco", async () => {
  const enviado = [];
  const pendiente = { ...P1, banco: BANCO, cuenta_pf: PF, falta: { r: true, i: true } };
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") {
      const b = JSON.parse(o.body);
      enviado.push(b);
      if (b.accion === "ver") {
        return new Response(JSON.stringify({ filas: planPlazosFijos({ plazos: b.plazos, ops: [], ctx: CTX, hoy: "2026-11-11", fechaPorDefecto: b.exportado }).filas }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, cargadas: 4, plazos: 2 }), { status: 200 });
    }
    return new Response(JSON.stringify({
      hoy: "2026-11-11",
      plazos: [{ ...P1, situacion: "vencido" }, { ...P3, situacion: "vigente" }, { ...P2, situacion: "terminado" }],
      pendientes: [pendiente],
      bancos: TESORERIA.filter((t) => t.tipo === "banco"), cuentas_pf: TESORERIA.filter((t) => t.tipo === "plazo_fijo"),
      por_defecto: { banco: "", cuenta_pf: "" },
    }), { status: 200 });
  };
  let cambios = 0;
  render(<FinanzasPlazosFijos onCambio={() => { cambios++; }} />);
  await waitFor(() => assert.ok(screen.getByLabelText("Plazos fijos")));
  const tabla = screen.getByLabelText("Plazos fijos");
  assert.match(tabla.textContent, /10000001.*Venció: falta registrar/);
  assert.doesNotMatch(tabla.textContent, /10000002/, "los que volvieron al banco no se ven");
  fireEvent.click(screen.getByLabelText(/Ver los que ya volvieron al banco \(1\)/));
  assert.match(screen.getByLabelText("Plazos fijos").textContent, /10000002.*Volvió al banco/);

  fireEvent.click(screen.getByRole("button", { name: /1 plazo fijo venció/ }));
  assert.match(screen.getByLabelText("Vencidos para registrar").textContent, /10000001.*interés/);
  fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
  await waitFor(() => assert.equal(cambios, 1));
  assert.deepEqual(enviado.pop(), { accion: "vencidos" });

  fireEvent.click(await screen.findByRole("button", { name: "📥 Importar del banco" }));
  const archivo = new File([xlsFalso({ hoja: "plazosFijosVigentesExport", celdas: CELDAS })], "plazosFijosVigentesExport.xls", { type: "application/vnd.ms-excel" });
  fireEvent.change(screen.getByLabelText("Planilla de plazos fijos"), { target: { files: [archivo] } });
  await waitFor(() => assert.ok(screen.getByLabelText("Plazos fijos de la planilla")));
  assert.equal(enviado[0].accion, "ver");
  assert.equal(enviado[0].banco, BANCO, "el banco del archivo");
  assert.equal(enviado[0].cuenta_pf, PF);
  assert.equal(enviado[0].exportado, "2026-10-29");
  const planilla = screen.getByLabelText("Plazos fijos de la planilla");
  assert.match(planilla.textContent, /10000002.*Se carga la constitución, el vencimiento y el interés/);
  assert.match(planilla.textContent, /10000004.*En dólares: cargalo a mano/);
  assert.match(screen.getByLabelText("Avisos de la planilla").textContent, /10000005/);
  fireEvent.change(screen.getByLabelText("Fecha en que se constituyó el 10000003"), { target: { value: "2026-10-15" } });
  fireEvent.click(screen.getByLabelText("Cargar el plazo fijo 10000001"));
  fireEvent.click(screen.getByRole("button", { name: /^Cargar \(4 operaciones\)/ }));
  await waitFor(() => assert.equal(cambios, 2));
  const cargar = enviado.find((b) => b.accion === "cargar");
  assert.deepEqual(cargar.omitir, ["10000001"]);
  assert.equal(cargar.fechas["10000003"], "2026-10-15");
});
