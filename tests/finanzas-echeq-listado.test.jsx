// tests/finanzas-echeq-listado.test.jsx — Parte 6 del plan de Tesorería
// (13/11): el listado de e-cheq del banco pone al día 🏦 Cheques (migración
// 189, fin_cheques.id_banco).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  leerListadoEcheq, cuentaPropiaDe, estadoDelBanco, planListado, chequeNuevo, resumenListado, cuitLimpio,
} from "../app/lib/finanzasEcheqListado.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/cheques/listado/route.js");
const { default: ListadoEcheq } = await import("../app/components/FinanzasEcheqListado.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PROPIA = "191-416-000001/2";
const OTRA = "191-000-999999/1";
const MI_CUIT = "30-11111111-1";
const BANCO = "01.01.01.003.002";
const TITULOS = ["Nro. de Cheque", "Caracter", "Fecha de Pago", "Fecha Ult. Modificacion", "Moneda", "Monto", "Cuenta Emisor", "Beneficiario", "CUIT-CUIL CDI", "Motivo", "Id. Cheque", "Endosado A", "CUIT Endosatario", "Cedido A", "Codigo Banco", "Banco", "Estado", "Codigo Postal"];
const fila = (numero, pago, monto, emisor, benef, id, endosado, cuitEnd, estado, cuitBenef = "30-22222222-2") =>
  [numero, "A LA ORDEN", pago, pago, "Pesos", monto, emisor, benef, cuitBenef, "Varios", id, endosado, cuitEnd, "", "191", "BANCO CREDICOOP", estado, "5000"];
const GRILLA = [
  ["Listado de ECHEQ"],
  TITULOS,
  fila("101", "05/10/2026", "1.000,00", PROPIA, "MADERAS SA", "ID1", "", "", "PAGADO"),
  fila("102", "20/11/2026", "2.000,00", PROPIA, "HERRAJES SRL", "ID2", "", "", "ACTIVO"),
  fila("103", "01/10/2026", "3.000,00", PROPIA, "OTRO SA", "ID3", "", "", "ANULADO"),
  fila("501", "07/10/2026", "5.000,00", OTRA, "MI EMPRESA SRL", "ID4", "MI EMPRESA SRL", MI_CUIT, "PAGADO"),
  fila("502", "08/10/2026", "6.000,00", OTRA, "MADERAS SA", "ID5", "MADERAS SA", "30-22222222-2", "PAGADO"),
  fila("503", "09/10/2026", "7.000,00", OTRA, "MI EMPRESA SRL", "ID6", "MI EMPRESA SRL", MI_CUIT, "RECHAZADO"),
  fila("504", "09/10/2026", "8.000,00", OTRA, "X", "ID6", "", "", "PAGADO"),
];

// ─── Reglas ───

test("leer el listado — títulos en cualquier fila, sin Id. repetido, importes y fechas argentinas", () => {
  const { cheques, error } = leerListadoEcheq(GRILLA);
  assert.equal(error, undefined);
  assert.equal(cheques.length, 6, "el Id. repetido no entra dos veces");
  assert.deepEqual([cheques[0].id_banco, cheques[0].numero, cheques[0].fecha_pago, cheques[0].monto, cheques[0].estado_banco], ["ID1", "101", "2026-10-05", 1000, "PAGADO"]);
  assert.equal(cheques[3].cuit_endosatario, "30111111111");
  assert.match(leerListadoEcheq([["Fecha", "Monto"]]).error, /Id\. Cheque/);
  assert.equal(cuentaPropiaDe(cheques), PROPIA, "la que más emitió sin endoso");
});

test("estado del banco — la tabla del plan", () => {
  const c = (estado_banco, cuit_endosatario = "") => ({ estado_banco, cuit_endosatario });
  assert.deepEqual(["ACTIVO", "PAGADO", "RECHAZADO", "ANULADO", "CUSTODIA"].map((s) => estadoDelBanco(c(s), "propio", MI_CUIT)), ["pendiente", "debitado", "rechazado", "anulado", "pendiente"]);
  assert.deepEqual(["ACTIVO", "PAGADO", "CUSTODIA"].map((s) => estadoDelBanco(c(s, cuitLimpio(MI_CUIT)), "tercero", MI_CUIT)), ["en_cartera", "depositado", "en_cartera"]);
  assert.deepEqual(["ACTIVO", "PAGADO"].map((s) => estadoDelBanco(c(s, "30222222222"), "tercero", MI_CUIT)), ["entregado", "entregado"], "endosado a otro CUIT");
  assert.equal(estadoDelBanco(c("RARO"), "propio", MI_CUIT), null);
});

test("plan — por Id., por número y monto, nuevo, igual y lo que va a mano", () => {
  const { cheques } = leerListadoEcheq(GRILLA);
  const gypi = [
    { id: 1, clase: "propio", estado: "pendiente", numero: "000101", importe: 1000, id_banco: null },
    { id: 2, clase: "propio", estado: "pendiente", numero: "102", importe: 2000, id_banco: "ID2" },
    { id: 3, clase: "tercero", estado: "depositado", numero: "501", importe: 5000, id_banco: null },
    { id: 4, clase: "tercero", estado: "en_cartera", numero: "502", importe: 6000, id_banco: null },
  ];
  const proveedores = [{ id: 9, nombre: "Maderas SA", cuit: "30-22222222-2" }];
  const { filas } = planListado(cheques, gypi, { cuentaPropia: PROPIA, cuitEmpresa: MI_CUIT, proveedores });
  const por = Object.fromEntries(filas.map((f) => [f.c.id_banco, f]));
  assert.deepEqual([por.ID1.que, por.ID1.accion, por.ID1.cheque.id], ["cambia", "debitado", 1], "por número (sin ceros) y monto");
  assert.equal(por.ID2.que, "igual");
  assert.deepEqual([por.ID3.que, por.ID3.estado], ["nuevo", "anulado"]);
  assert.deepEqual([por.ID4.que, por.ID4.accion], ["cambia", null], "mismo estado: solo se une con el Id. del banco");
  assert.deepEqual([por.ID5.que, por.ID5.accion, por.ID5.proveedor.id], ["cambia", "entregado", 9], "endosado al proveedor, por CUIT");
  assert.equal(por.ID6.que, "nuevo");
  assert.deepEqual(resumenListado(filas), { propio: 3, tercero: 3, igual: 1, cambia: 3, nuevo: 2, no: 0 });
  // Sin el proveedor del endoso, o un cambio que Cheques no hace solo: a mano
  const sinProv = planListado(cheques, gypi, { cuentaPropia: PROPIA, cuitEmpresa: MI_CUIT, proveedores: [] }).filas.find((f) => f.c.id_banco === "ID5");
  assert.equal(sinProv.que, "no");
  assert.match(sinProv.texto, /no está en Proveedores/);
  const raro = planListado(cheques, [{ id: 7, clase: "propio", estado: "debitado", numero: "103", importe: 3000 }], { cuentaPropia: PROPIA }).filas.find((f) => f.c.id_banco === "ID3");
  assert.equal(raro.que, "no", "un debitado no pasa a anulado solo");
});

test("cheque nuevo — sin operación, con el Id. del banco y el origen listado", () => {
  const { cheques } = leerListadoEcheq(GRILLA);
  const { filas } = planListado(cheques, [], { cuentaPropia: PROPIA, cuitEmpresa: MI_CUIT, proveedores: [{ id: 9, nombre: "Maderas SA", cuit: "30-22222222-2" }] });
  const p = chequeNuevo(filas[1], { cuentaBanco: BANCO });
  assert.deepEqual([p.origen, p.id_banco, p.clase, p.estado, p.importe, p.cuenta_banco, p.beneficiario], ["listado", "ID2", "propio", "pendiente", 2000, BANCO, "HERRAJES SRL"]);
  const t = chequeNuevo(filas.find((f) => f.c.id_banco === "ID5"));
  assert.deepEqual([t.clase, t.estado, t.proveedor_id, t.entregado_a, t.cuenta_banco], ["tercero", "entregado", 9, "Maderas SA", null]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/cheques/listado", {
  method: "POST",
  headers: { Authorization: `Bearer ${await token(rol)}`, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
  body: body instanceof FormData ? body : JSON.stringify(body),
}));

const CUENTAS = [
  { codigo: "02.01.02.001.001", nombre: "Proveedores" }, { codigo: "02.01.03", nombre: "E-cheq diferidos a pagar" },
  { codigo: "01.01.04", nombre: "Valores a depositar" }, { codigo: "01.01.05", nombre: "Cheques rechazados" }, { codigo: "01.01.02.001", nombre: "Deudores por ventas" },
];

function mockApi({ gypi = [], enBanco = [] } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq.") && u.includes("select=cuit"), respond: () => ({ status: 200, body: [{ cuit: MI_CUIT }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO, nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true }] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [{ id: 9, nombre: "Maderas SA", cuit: "30-22222222-2" }] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_cheques"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_cheques", metodo: o.method, url: decodeURIComponent(u), body });
          return { status: 200, body: Array.isArray(body) ? body : [{ id: 1, ...body }] };
        }
        if (u.includes("op_cierre_id=not.is.null")) return { status: 200, body: [] };
        return { status: 200, body: gypi };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_operaciones", metodo: o.method, url: decodeURIComponent(u), body });
          return { status: 200, body: [{ id: 77, ...body }] };
        }
        return { status: 200, body: enBanco };
      },
    },
  ]);
  return escrito;
}

const csv = () => [TITULOS, ...GRILLA.slice(2)].map((r) => r.join(";")).join("\n");

test("/api/finanzas/cheques/listado — solo el Dueño; leer devuelve los cheques, la cuenta propia y el CUIT", async () => {
  mockApi();
  assert.equal((await pedir("administrativo", { accion: "aplicar" })).status, 403);
  const form = new FormData();
  form.append("file", new File([csv()], "Lista_de_ECHEQ.csv", { type: "text/csv" }));
  const r = await pedir("gerencial", form);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual([d.cheques.length, d.cuenta_propia, d.cuit_empresa, d.cuenta_banco], [6, PROPIA, "30111111111", BANCO]);
});

test("/api/finanzas/cheques/listado — aplicar: suma sin operación, une el débito que ya está en el banco y carga el depósito que falta", async () => {
  const gypi = [
    { id: 1, clase: "propio", tipo: "echeq_diferido", estado: "pendiente", numero: "101", importe: 1000, fecha_pago: "2026-10-05", banco: "Credicoop", id_banco: null },
    { id: 3, clase: "tercero", tipo: "echeq_diferido", estado: "en_cartera", numero: "501", importe: 5000, fecha_pago: "2026-10-07", id_banco: null },
  ];
  const enBanco = [{ id: 55, fecha: "2026-10-06", total: 1000, total_ars: 1000, cuenta_debe: "02.01.03", cuenta_haber: BANCO, origen: "banco" }];
  const escrito = mockApi({ gypi, enBanco });
  const { cheques } = leerListadoEcheq(GRILLA);
  const r = await pedir("gerencial", { accion: "aplicar", cheques, cuenta_propia: PROPIA, cuit_empresa: MI_CUIT, cuenta_banco: BANCO, elegidos: ["ID1", "ID2", "ID4"] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual([d.sumados, d.cambiados, d.unidos_al_banco], [1, 2, 1]);
  const nuevos = escrito.find((x) => x.tabla === "fin_cheques" && x.metodo === "POST").body;
  assert.deepEqual(nuevos.map((c) => [c.id_banco, c.origen, c.estado, c.empresa_id]), [["ID2", "listado", "pendiente", E]]);
  const debito = escrito.filter((x) => x.tabla === "fin_cheques" && x.metodo === "PATCH" && x.url.includes("id=eq.1"));
  assert.deepEqual([debito[0].body.estado, debito[0].body.id_banco], ["debitado", "ID1"]);
  assert.match(debito[0].url, /estado=eq\.pendiente/);
  assert.equal(debito[1].body.op_cierre_id, 55, "unido al débito del extracto");
  const ops = escrito.filter((x) => x.tabla === "fin_operaciones" && x.metodo === "POST");
  assert.equal(ops.length, 1, "solo el depósito, que no estaba en el banco");
  assert.deepEqual([ops[0].body.cuenta_debe, ops[0].body.total, ops[0].body.fecha], [BANCO, 5000, "2026-10-07"]);
  assert.equal((await pedir("gerencial", { accion: "aplicar", cheques, cuenta_propia: PROPIA, cuenta_banco: "otro", elegidos: ["ID1"] })).status, 400);
});

// ─── Pantalla ───

test("pantalla — sube el listado, muestra qué cambia y aplica lo elegido", async () => {
  const { cheques } = leerListadoEcheq(GRILLA);
  const posts = [];
  global.fetch = async (url, o = {}) => {
    if (o.body instanceof FormData) {
      return new Response(JSON.stringify({
        ok: true, cheques, cuenta_propia: PROPIA, cuentas_emisoras: [{ cuenta: PROPIA, cantidad: 3 }, { cuenta: OTRA, cantidad: 4 }],
        cuit_empresa: "", cuenta_banco: BANCO, bancos: [{ cuenta: BANCO, nombre: "Banco Credicoop" }],
        gypi: [{ id: 1, clase: "propio", estado: "pendiente", numero: "101", importe: 1000, id_banco: null }], proveedores: [],
      }), { status: 200 });
    }
    posts.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true, cambiados: 1, sumados: 4, unidos_al_banco: 0, solo_id: 0, errores: [] }), { status: 200 });
  };
  let aplicado = false;
  render(<ListadoEcheq onCerrar={() => {}} onAplicado={() => { aplicado = true; }} />);
  fireEvent.change(screen.getByLabelText("Archivo del listado"), { target: { files: [new File(["x"], "lista.xls")] } });
  await screen.findByText(/3 emitidos/);
  assert.ok(screen.getByText(/Poné el CUIT de tu empresa/));
  fireEvent.change(screen.getByLabelText("CUIT de tu empresa"), { target: { value: MI_CUIT } });
  assert.equal(screen.queryByText(/Poné el CUIT de tu empresa/), null);
  fireEvent.click(screen.getByRole("button", { name: /Se suman/ }));
  assert.ok(screen.getByLabelText("Cheque 502"), "el grupo se abre");
  fireEvent.click(screen.getByLabelText("Cheque 101"));
  fireEvent.click(screen.getByRole("button", { name: /Poner al día 5 cheques/ }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.deepEqual([posts[0].accion, posts[0].cuenta_banco, posts[0].cuit_empresa, posts[0].elegidos.includes("ID1")], ["aplicar", BANCO, MI_CUIT, false]);
  await waitFor(() => assert.ok(aplicado));
});
