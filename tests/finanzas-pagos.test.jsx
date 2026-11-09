// tests/finanzas-pagos.test.jsx — Finanzas, parte F2b (2; migración 175):
// órdenes de pago con varias formas, link para que el CFO apruebe o rechace
// sin usuario, y al pagarla las operaciones y los cheques salen solos.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  validarOrden, generarPago, textoForma, accionesOrden, datosParaCfo, textoWhatsappCfo, htmlOrdenPago, cuentasParaPagar,
} from "../app/lib/finanzasPagos.js";
import { slugReservado } from "../app/lib/slugs.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/pagos/route.js");
const decidirApi = await import("../app/api/op/decidir/route.js");
const { decidirOrden } = await import("../app/lib/ordenPagoCfo.js");
const { default: FinanzasPagos } = await import("../app/components/FinanzasPagos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const CUENTAS = [
  { codigo: "01.01.01.002.001", nombre: "Valores A Depositar", activa: true },
  { codigo: "01.01.01.022.001", nombre: "Valores A Depositar - E-Cheq", activa: true },
  { codigo: "02.01.01.001.005", nombre: "E-cheq diferidos a pagar- Bco Credicoop", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
];
const TESORERIA = [
  { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: "01.01.01.001.002", nombre: "Caja Dólares", tipo: "caja", moneda: "USD", activa: true },
  { cuenta: "01.01.01.003.002", nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true },
];
const PROVEEDORES = [{ id: 5, nombre: "EGGER ARGENTINA", activo: true }];
const CARTERA = { id: 11, clase: "tercero", tipo: "cheque_fisico", banco: "Bancor", numero: "389", importe: 300000, fecha_pago: "2026-11-20", librador: "Municipalidad", estado: "en_cartera" };
const CTX = { cuentas: CUENTAS, tesoreria: TESORERIA, proveedores: PROVEEDORES, cheques: [CARTERA] };
const FORMAS = [
  { forma: "efectivo", cuenta: "01.01.01.001.001.01", importe: 100000 },
  { forma: "transferencia", cuenta: "01.01.01.003.002", importe: 200000 },
  { forma: "echeq", importe: 400000, fecha_pago: "2026-12-15" },
  { forma: "cheque_tercero", cheque_id: 11 },
];
const ORDEN = { id: 9, empresa_id: E, numero: 4, proveedor_id: 5, proveedor_nombre: "EGGER ARGENTINA", fecha: "2026-11-09", total: 1000000, estado: "aprobada", facturas: [], notas: null };

// ─── Reglas ───

test("validar — el total es la suma de las formas; el cheque de la cartera trae su importe", () => {
  const { orden, errores } = validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: FORMAS, facturas: [{ op_id: 3, fecha: "2026-10-01", detalle: "Factura A 1", importe: 1000000 }] }, CTX);
  assert.deepEqual(errores, []);
  assert.equal(orden.total, 1000000);
  assert.equal(orden.formas[3].importe, 300000);
  assert.equal(orden.formas[2].cuenta, "01.01.01.003.002", "el e-cheq sale del Credicoop");
  assert.equal(orden.formas[0].cuenta_nombre, "Caja Principal");
  assert.equal(orden.facturas.length, 1);
});

test("validar — proveedor, formas, la caja en dólares no y el cheque una sola vez", () => {
  assert.match(validarOrden({ fecha: "2026-11-09", formas: FORMAS }, CTX).errores[0], /proveedor/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: [] }, CTX).errores[0], /con qué/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: [{ forma: "efectivo", cuenta: "01.01.01.001.002", importe: 5 }] }, CTX).errores[0], /caja/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: [{ forma: "cheque_tercero", cheque_id: 11 }, { forma: "cheque_tercero", cheque_id: 11 }] }, CTX).errores[0], /ya está/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: [{ forma: "echeq", importe: 5 }] }, CTX).errores[0], /fecha de pago/);
  assert.match(validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: [{ forma: "cheque_tercero", cheque_id: 11 }] }, { ...CTX, cheques: [{ ...CARTERA, estado: "depositado" }] }).errores[0], /cartera/);
  assert.equal(cuentasParaPagar(TESORERIA).cajas.length, 1);
});

test("estados — qué se puede hacer en cada uno", () => {
  assert.deepEqual(accionesOrden("borrador"), ["mandar", "anular"]);
  assert.deepEqual(accionesOrden("aprobada"), ["pagar", "anular"]);
  assert.deepEqual(accionesOrden("pagada"), ["anular"]);
  assert.deepEqual(accionesOrden("anulada"), []);
  assert.ok(slugReservado("op"), "/op/ no puede ser el slug de una empresa");
});

test("pagar — efectivo y transferencia contra Proveedores, el e-cheq nuevo y el cheque a entregar", () => {
  const { orden } = validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: FORMAS }, CTX);
  const plan = generarPago({ ...ORDEN, ...orden }, CTX, "2026-11-10");
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.operaciones.map((o) => [o.tipo, o.cuenta_debe, o.cuenta_haber, o.total, o.origen, o.origen_id]), [
    ["PAGO A PROVEEDORES", "02.01.02.001.001", "01.01.01.001.001.01", 100000, "orden_pago", "9:0"],
    ["PAGO A PROVEEDORES", "02.01.02.001.001", "01.01.01.003.002", 200000, "orden_pago", "9:1"],
  ]);
  assert.equal(plan.operaciones[0].referencia, "OP 4");
  assert.deepEqual([plan.emitir[0].banco, plan.emitir[0].estado, plan.emitir[0].origen, plan.emitir[0].fecha_pago, plan.emitir[0].proveedor_id], ["Credicoop", "pendiente", "pago", "2026-12-15", 5]);
  assert.deepEqual(plan.entregar, [{ cheque_id: 11 }]);
  assert.match(generarPago(ORDEN, { ...CTX, cuentas: [] }, "2026-11-10").error, /Proveedores/);
});

test("CFO — ve qué se paga y con qué, sin cuentas; el WhatsApp lleva el link", () => {
  const { orden } = validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: FORMAS }, CTX);
  const o = { ...ORDEN, ...orden, estado: "para_aprobar", token: TOKEN };
  const d = datosParaCfo(o, { nombre: "Gi amoblamientos", logo_url: "javascript:x" });
  assert.equal(d.empresa.logo, null);
  assert.equal(JSON.stringify(d).includes("02.01.02"), false, "sin códigos de cuenta");
  assert.equal(JSON.stringify(d).includes(TOKEN), false);
  assert.match(d.formas[3].texto, /Bancor N° 389 · vence el 20\/11\/26/);
  const w = textoWhatsappCfo(o, `https://x/op/${TOKEN}`, { empresa: "Gi", cfo: "Juan" });
  assert.match(w, /Hola Juan/);
  assert.match(w, new RegExp(`https://x/op/${TOKEN}`));
  assert.match(textoForma({ forma: "echeq", fecha_pago: "2026-12-15" }), /E-cheq Credicoop · se debita el 15\/12\/26/);
  assert.match(htmlOrdenPago({ empresa: {}, orden: { ...o, proveedor_nombre: "<b>x</b>" } }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("migración 175 — fin_ordenes_pago con RLS solo Dueño y sin delete", () => {
  const sql = readFileSync(new URL("../supabase/migrations/175_finanzas_ordenes_pago.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.fin_ordenes_pago/);
  assert.match(sql, /token\s+text unique/);
  assert.match(sql, /->>'rol'\) = 'gerencial'/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*fin_ordenes_pago/);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body, query = "") => api[metodo](new Request(`http://localhost/api/finanzas/pagos${query}`, {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ ordenes = [], cheques = [CARTERA], sin175 = false } = {}) {
  const escrito = [];
  let opId = 70;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo", legajo: 7 }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: { nombre: "Juan", telefono: "351 555 1234" } }] }) },
    { match: (u) => u.includes("/rest/v1/push_tokens"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_ordenes_pago"),
      respond: (u, o) => {
        if (sin175) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_ordenes_pago" does not exist' } };
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_ordenes_pago", url: u, metodo: o.method, body });
          if (o.method === "POST") return { status: 201, body: [{ id: 9, ...body }] };
          const or = ordenes.find((x) => u.includes(`id=eq.${x.id}&`));
          if (!or || (/estado=eq\./.test(u) && !u.includes(`estado=eq.${or.estado}`))) return { status: 200, body: [] };
          return { status: 200, body: [{ ...or, ...body }] };
        }
        if (u.includes("token=eq.")) return { status: 200, body: ordenes.filter((x) => x.token && u.includes(`token=eq.${x.token}`)) };
        if (u.includes("order=numero.desc&limit=1")) return { status: 200, body: ordenes.slice(0, 1) };
        return { status: 200, body: /[?&]id=eq\./.test(u) ? ordenes.filter((x) => u.includes(`id=eq.${x.id}&`)) : ordenes };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_cheques"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_cheques", url: u, metodo: o.method, body });
          if (o.method === "POST") return { status: 201, body: [{ id: 60, ...body }] };
          const ch = cheques.find((c) => u.includes(`id=eq.${c.id}&`)) || { id: 60, estado: "pendiente" };
          if (/estado=eq\./.test(u) && !u.includes(`estado=eq.${ch.estado}`)) return { status: 200, body: [] };
          return { status: 200, body: [{ ...ch, ...body }] };
        }
        if (u.includes("id=in.")) return { status: 200, body: cheques };
        return { status: 200, body: cheques.filter((c) => c.estado === "en_cartera") };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        const body = o?.body ? JSON.parse(o.body) : null;
        escrito.push({ tabla: "fin_operaciones", url: u, metodo: o?.method || "GET", body });
        const lista = Array.isArray(body) ? body : [body];
        return { status: 201, body: lista.map((b) => ({ id: opId++, ...b })) };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
  ]);
  return { escrito };
}

test("/api/finanzas/pagos — solo el Dueño; sin la 175 avisa", async () => {
  const { escrito } = mockApi();
  for (const rol of ["administrativo", "operativo"]) {
    assert.equal((await pedir(rol, "GET")).status, 403, rol);
    assert.equal((await pedir(rol, "POST", { accion: "pagar", id: 9 })).status, 403, rol);
  }
  assert.equal(escrito.length, 0);
  mockApi({ sin175: true });
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 175/);
});

test("/api/finanzas/pagos — crear y mandar: número siguiente, link largo para el CFO", async () => {
  const { escrito } = mockApi({ ordenes: [{ ...ORDEN, numero: 3 }] });
  const res = await pedir("gerencial", "POST", { accion: "crear", mandar: true, orden: { proveedor_id: 5, fecha: "2026-11-09", formas: FORMAS } });
  assert.equal(res.status, 200);
  const d = await res.json();
  const [ins] = escrito;
  assert.deepEqual([ins.body.numero, ins.body.estado, ins.body.total, ins.body.cargada_por_nombre], [4, "para_aprobar", 1000000, "Tadeo"]);
  assert.ok(ins.body.token.length >= 30);
  assert.equal(d.url, `http://localhost/op/${ins.body.token}`);
  assert.equal(escrito.filter((x) => x.tabla !== "fin_ordenes_pago").length, 0, "crear no mueve plata");
});

test("/api/finanzas/pagos — pagar solo aprobadas; genera operaciones, e-cheq y entrega el cheque", async () => {
  const { orden } = validarOrden({ proveedor_id: 5, fecha: "2026-11-09", formas: FORMAS }, CTX);
  mockApi({ ordenes: [{ ...ORDEN, ...orden, estado: "para_aprobar" }] });
  assert.equal((await pedir("gerencial", "POST", { accion: "pagar", id: 9, fecha: "2026-11-10" })).status, 400);

  const { escrito } = mockApi({ ordenes: [{ ...ORDEN, ...orden }] });
  const res = await pedir("gerencial", "POST", { accion: "pagar", id: 9, fecha: "2026-11-10" });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const marca = escrito[0];
  assert.match(marca.url, /estado=eq\.aprobada/, "se marca primero, para no pagar dos veces");
  assert.equal(marca.body.estado, "pagada");
  const ops = escrito.filter((x) => x.tabla === "fin_operaciones" && x.metodo === "POST").flatMap((x) => (Array.isArray(x.body) ? x.body : [x.body]));
  assert.deepEqual(ops.map((o) => o.tipo), ["PAGO A PROVEEDORES", "PAGO A PROVEEDORES", "PAGO A PROVEEDORES", "PAGO A PROVEEDORES"]);
  const nuevo = escrito.find((x) => x.tabla === "fin_cheques" && x.metodo === "POST");
  assert.equal(nuevo.body.origen, "pago");
  const entrega = escrito.find((x) => x.tabla === "fin_cheques" && x.url.includes("id=eq.11&") && x.body.estado === "entregado");
  assert.match(entrega.url, /estado=eq\.en_cartera/);
  const { generado } = await res.json();
  assert.deepEqual([generado.operaciones.length, generado.cheques_emitidos, generado.cheques_entregados], [2, [60], [11]]);
});

test("/api/finanzas/pagos — anular una pagada deshace todo; no si el e-cheq ya se debitó", async () => {
  const pagada = { ...ORDEN, estado: "pagada", generado: { operaciones: [70, 71], cheques_emitidos: [60], cheques_entregados: [11] } };
  const { escrito } = mockApi({ ordenes: [pagada], cheques: [{ id: 60, clase: "propio", estado: "pendiente", op_alta_id: 72 }, { ...CARTERA, estado: "entregado", op_cierre_id: 73 }] });
  const res = await pedir("gerencial", "POST", { accion: "anular", id: 9 });
  assert.equal(res.status, 200);
  const anuladas = escrito.filter((x) => x.tabla === "fin_operaciones" && x.metodo === "PATCH").map((x) => Number(x.url.match(/id=eq\.(\d+)/)[1]));
  assert.deepEqual(anuladas.sort(), [70, 71, 72, 73]);
  assert.ok(escrito.some((x) => x.tabla === "fin_cheques" && x.url.includes("id=eq.60&") && x.body.estado === "anulado"));
  assert.ok(escrito.some((x) => x.tabla === "fin_cheques" && x.url.includes("id=eq.11&") && x.body.estado === "en_cartera"));

  const r2 = mockApi({ ordenes: [pagada], cheques: [{ id: 60, clase: "propio", numero: "77", estado: "debitado" }] });
  const mal = await pedir("gerencial", "POST", { accion: "anular", id: 9 });
  assert.equal(mal.status, 400);
  assert.match((await mal.json()).error, /ya se debitó/);
  assert.equal(r2.escrito.length, 0);
});

test("CFO — aprueba con el link; rechazar pide motivo; un link viejo no sirve", async () => {
  const esperando = { ...ORDEN, estado: "para_aprobar", token: TOKEN };
  const { escrito } = mockApi({ ordenes: [esperando] });
  assert.equal((await decidirOrden(TOKEN, "rechazar", { nota: "" })).status, 400);
  const r = await decidirOrden(TOKEN, "aprobar", { nombre: "Juan" }, { messaging: { send: async () => {} } });
  assert.deepEqual(r, { ok: true, estado: "aprobada" });
  const p = escrito.find((x) => x.tabla === "fin_ordenes_pago");
  assert.match(p.url, /estado=eq\.para_aprobar&token=eq\./);
  assert.deepEqual([p.body.estado, p.body.decidida_por_nombre], ["aprobada", "Juan"]);

  mockApi({ ordenes: [{ ...esperando, estado: "aprobada" }] });
  assert.equal((await decidirOrden(TOKEN, "aprobar")).status, 409);
  mockApi({ ordenes: [] });
  assert.equal((await decidirOrden("corto", "aprobar")).status, 404);
  const res = await decidirApi.POST(new Request("http://localhost/api/op/decidir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: TOKEN, decision: "aprobar" }) }));
  assert.equal(res.status, 404);
});

// ─── Pantalla ───

test("pantalla — lista las órdenes y arma una nueva con el total de las formas", async () => {
  const datos = {
    tesoreria: TESORERIA, proveedores: PROVEEDORES, cheques: [CARTERA], empresa: { nombre: "Gi" }, cfo: { nombre: "Juan", telefono: "" }, links: {},
    ordenes: [{ ...ORDEN, formas: [{ forma: "efectivo", importe: 1000000, cuenta_nombre: "Caja Principal" }] }],
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { const b = JSON.parse(o.body); enviados.push(b); return new Response(JSON.stringify({ ok: true, orden: { id: 10, numero: 5, ...b.orden } }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasPagos />);
  assert.ok(await screen.findByText("EGGER ARGENTINA"));
  assert.ok(screen.getByText(/Aprueba:/));
  fireEvent.click(screen.getByRole("button", { name: "+ Orden de pago" }));
  await screen.findByRole("option", { name: "EGGER ARGENTINA" });
  fireEvent.change(screen.getByLabelText("Proveedor"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "+ Efectivo" }));
  fireEvent.change(screen.getByLabelText("Importe en Efectivo"), { target: { value: "1.500,50" } });
  assert.ok(screen.getByText("$ 1.500,50"));
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  const [b] = enviados;
  assert.deepEqual([b.accion, b.mandar, b.orden.proveedor_id, b.orden.formas[0].importe, b.orden.formas[0].cuenta], ["crear", false, 5, 1500.5, "01.01.01.001.001.01"]);
});
