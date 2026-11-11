// tests/finanzas-pases.test.jsx — Mi caja: pasar plata de una persona a otra
// (10/11). Queda pendiente hasta que el que recibe confirma; recién ahí se
// anota la transferencia entre las dos cajas.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { destinosPase, validarPase, operacionDePase, pasesDe, guardarPases, leerPases, ORIGEN_PASE } from "../app/lib/finanzasPases.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/mi-caja/route.js");
const { default: MiCaja, detalleMiCaja } = await import("../app/components/MiCaja.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EZE = "22222222-2222-2222-2222-222222222222";
const MAYCO = "33333333-3333-3333-3333-333333333333";
const CAJA_EZE = { cuenta: "01.01.01.001.001.02", nombre: "Caja Ezequiel", tipo: "caja", moneda: "ARS", activa: true, responsable_id: EZE };
const CAJA_MAYCO = { cuenta: "01.01.01.001.001.03", nombre: "Caja Mayco", tipo: "caja", moneda: "ARS", activa: true, responsable_id: MAYCO };
const CAJA_USD = { cuenta: "01.01.01.001.002.01", nombre: "Caja dólares Mayco", tipo: "caja", moneda: "USD", activa: true, responsable_id: MAYCO };
const CAJA_PRINCIPAL = { cuenta: "01.01.01.001.001.01", nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true, responsable_id: null };
const PERSONAL = [{ id: EZE, nombre: "Ezequiel", legajo: 11 }, { id: MAYCO, nombre: "Mayco", legajo: 12 }];

// ─── Reglas ───

test("destinos — cajas de otras personas, activas y de la misma moneda", () => {
  const d = destinosPase(CAJA_EZE, [CAJA_EZE, CAJA_MAYCO, CAJA_USD, CAJA_PRINCIPAL, { ...CAJA_MAYCO, cuenta: "x", activa: false }], PERSONAL);
  assert.deepEqual(d.map((x) => [x.cuenta, x.persona]), [[CAJA_MAYCO.cuenta, "Mayco"]]);
  assert.deepEqual(destinosPase(null, [CAJA_MAYCO]), []);
});

test("pase — queda pendiente con quién lo pasó y a quién; lo que no corresponde se rechaza", () => {
  const destinos = destinosPase(CAJA_EZE, [CAJA_MAYCO], PERSONAL);
  const ctx = { caja: CAJA_EZE, destinos, quien: "Ezequiel", hoy: "2026-11-10", id: "pase-1", ahora: "2026-11-10T15:00:00Z" };
  const { pase, errores } = validarPase({ hacia: CAJA_MAYCO.cuenta, importe: 200000, fecha: "2026-11-10", descripcion: "para la obra" }, ctx);
  assert.deepEqual(errores, []);
  assert.equal(pase.estado, "pendiente");
  assert.deepEqual([pase.desde, pase.hacia, pase.de_nombre, pase.para_nombre, pase.para_id, pase.importe], [CAJA_EZE.cuenta, CAJA_MAYCO.cuenta, "Ezequiel", "Mayco", MAYCO, 200000]);
  assert.ok(validarPase({ hacia: CAJA_PRINCIPAL.cuenta, importe: 1, fecha: "2026-11-10" }, ctx).errores.includes("Elegí a quién le pasaste la plata"));
  assert.ok(validarPase({ hacia: CAJA_MAYCO.cuenta, importe: 0, fecha: "2026-11-10" }, ctx).errores.length);
  assert.ok(validarPase({ hacia: CAJA_MAYCO.cuenta, importe: 5, fecha: "2026-11-11" }, ctx).errores.includes("La fecha no puede ser más adelante que hoy"));
});

test("confirmado — transferencia de la caja que pasó a la que recibe, confirmada", () => {
  const pase = { id: "pase-1", desde: CAJA_EZE.cuenta, hacia: CAJA_MAYCO.cuenta, importe: 200000, fecha: "2026-11-10", de_nombre: "Ezequiel", para_nombre: "Mayco", nota: "obra" };
  const { op } = operacionDePase(pase, [CAJA_EZE, CAJA_MAYCO]);
  assert.deepEqual([op.cuenta_debe, op.cuenta_haber, op.total, op.estado, op.origen, op.origen_id, op.tipo], [CAJA_MAYCO.cuenta, CAJA_EZE.cuenta, 200000, "confirmada", ORIGEN_PASE, "pase-1", "TRANSFERENCIA ENTRE CAJAS"]);
  assert.equal(op.descripcion, "De Caja Ezequiel a Caja Mayco · obra");
  assert.equal(operacionDePase(pase, [CAJA_EZE]).op, undefined, "si una caja ya no está, no se anota");
});

test("lista — cada uno ve lo suyo; se guardan todos los pendientes y los últimos resueltos", () => {
  const pases = [
    { id: "a", estado: "pendiente", desde: CAJA_EZE.cuenta, hacia: CAJA_MAYCO.cuenta, importe: 1, fecha: "2026-11-10" },
    { id: "b", estado: "recibido", desde: CAJA_EZE.cuenta, hacia: CAJA_MAYCO.cuenta, importe: 2, fecha: "2026-11-09", resuelto_at: "2026-11-09" },
  ];
  assert.deepEqual(pasesDe(pases, [CAJA_MAYCO.cuenta]).para_confirmar.map((p) => p.id), ["a"]);
  assert.deepEqual(pasesDe(pases, [CAJA_EZE.cuenta]).esperando.map((p) => p.id), ["a"]);
  assert.deepEqual(pasesDe(pases, [CAJA_EZE.cuenta]).para_confirmar, []);
  const muchos = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}`, estado: "rechazado", desde: "x", hacia: "y", resuelto_at: `2026-${String(i).padStart(4, "0")}` }));
  const guardado = guardarPases([...pases, ...muchos]);
  assert.equal(guardado.pases.length, 201);
  assert.equal(guardado.pases[0].id, "a");
  assert.deepEqual(leerPases({ pases: [{ id: "x" }, null, ...pases] }).map((p) => p.id), ["a", "b"]);
  assert.equal(detalleMiCaja([{ nombre: "C", saldo: 10, moneda: "ARS", para_revisar: 0 }], [{ id: "a" }]), "💸 1 pase para confirmar · Saldo $ 10,00");
});

// ─── Servidor ───

async function token(empleadoId) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol: "operativo" })).token;
}
const pedir = async (empleadoId, metodo, body) => api[metodo](new Request("http://localhost/api/mi-caja", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(empleadoId)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ pases = [] } = {}) {
  const estado = { pases: [...pases], existe: pases.length > 0 };
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: (u) => ({ status: 200, body: PERSONAL.filter((p) => !/[?&]id=eq\./.test(u) || new RegExp(`[?&]id=eq.${p.id}`).test(u)) }) },
    {
      match: (u) => u.includes("/rest/v1/fin_tesoreria"),
      respond: (u) => ({ status: 200, body: [CAJA_EZE, CAJA_MAYCO, CAJA_PRINCIPAL].filter((c) => (!u.includes("responsable_id=eq.") || u.includes(`responsable_id=eq.${c.responsable_id}`)) && (!u.includes("responsable_id=not.is.null") || c.responsable_id)) }),
    },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "config_sistema", metodo: o.method, body });
          estado.pases = body.valor.pases;
          estado.existe = true;
          return { status: 201, body: [] };
        }
        if (u.includes("finanzas_pases_caja")) return { status: 200, body: estado.existe ? [{ valor: { pases: estado.pases } }] : [] };
        return { status: 200, body: [] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { const body = JSON.parse(o.body); escrito.push({ tabla: "fin_operaciones", body }); return { status: 201, body: [{ id: 90, ...body }] }; }
        return { status: 200, body: [] };
      },
    },
    { match: (u) => u.includes("push_subscriptions") || u.includes("fcm") || u.includes("notificaciones"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return { estado, escrito };
}

test("/api/mi-caja — Ezequiel pasa, Mayco confirma: recién ahí se anota la transferencia", async () => {
  const m = mockApi();
  let r = await pedir(EZE, "GET");
  let d = await r.json();
  assert.deepEqual(d.cajas[0].destinos.map((x) => x.persona), ["Mayco"]);
  r = await pedir(EZE, "POST", { accion: "pasar", cuenta: CAJA_EZE.cuenta, hacia: CAJA_MAYCO.cuenta, importe: 200000, fecha: "2026-11-01" });
  assert.equal(r.status, 200);
  assert.equal(m.escrito.filter((x) => x.tabla === "fin_operaciones").length, 0, "pendiente: nada en las cajas");
  const id = m.estado.pases[0].id;
  d = await (await pedir(MAYCO, "GET")).json();
  assert.deepEqual(d.para_confirmar.map((p) => [p.id, p.de_nombre, p.importe]), [[id, "Ezequiel", 200000]]);
  d = await (await pedir(EZE, "GET")).json();
  assert.deepEqual(d.esperando.map((p) => p.id), [id]);
  // Ezequiel no puede confirmar su propio pase
  assert.equal((await pedir(EZE, "POST", { accion: "recibir", id })).status, 404);
  r = await pedir(MAYCO, "POST", { accion: "recibir", id });
  assert.equal(r.status, 200);
  const ops = m.escrito.filter((x) => x.tabla === "fin_operaciones");
  assert.equal(ops.length, 1);
  assert.deepEqual([ops[0].body.cuenta_debe, ops[0].body.cuenta_haber, ops[0].body.estado, ops[0].body.origen_id], [CAJA_MAYCO.cuenta, CAJA_EZE.cuenta, "confirmada", id]);
  assert.equal(m.estado.pases[0].estado, "recibido");
  assert.equal((await pedir(MAYCO, "POST", { accion: "recibir", id })).status, 404, "ya resuelto");
});

test("/api/mi-caja — no la recibió o la cancela: no se anota nada", async () => {
  const pase = { id: "pase-x", estado: "pendiente", desde: CAJA_EZE.cuenta, hacia: CAJA_MAYCO.cuenta, importe: 5000, moneda: "ARS", fecha: "2026-11-10", de_id: EZE, de_nombre: "Ezequiel", para_id: MAYCO, para_nombre: "Mayco" };
  let m = mockApi({ pases: [pase] });
  assert.equal((await pedir(MAYCO, "POST", { accion: "cancelar", id: "pase-x" })).status, 404, "cancelar es del que la pasó");
  assert.equal((await pedir(MAYCO, "POST", { accion: "rechazar", id: "pase-x" })).status, 200);
  assert.equal(m.estado.pases[0].estado, "rechazado");
  assert.equal(m.escrito.filter((x) => x.tabla === "fin_operaciones").length, 0);
  m = mockApi({ pases: [pase] });
  assert.equal((await pedir(EZE, "POST", { accion: "cancelar", id: "pase-x" })).status, 200);
  assert.equal(m.estado.pases[0].estado, "cancelado");
});

// ─── Pantalla ───

test("Mi caja — confirmar un pase y pasarle plata a otro", async () => {
  const enviados = [];
  global.fetch = async (url, o = {}) => { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  const datos = {
    hoy: "2026-11-10", conceptos: { gastos: [], ingresos: [] },
    cajas: [{ cuenta: CAJA_MAYCO.cuenta, nombre: "Caja Mayco", moneda: "ARS", saldo: 0, para_revisar: 0, movimientos: [], destinos: [{ cuenta: CAJA_EZE.cuenta, nombre: "Caja Ezequiel", persona: "Ezequiel", moneda: "ARS" }] }],
    para_confirmar: [{ id: "pase-1", fecha: "2026-11-10", importe: 200000, moneda: "ARS", de_nombre: "Ezequiel", hacia: CAJA_MAYCO.cuenta, nota: "" }],
    esperando: [],
  };
  let cambios = 0;
  render(<MiCaja datos={datos} onClose={() => {}} onCambio={() => { cambios++; }} />);
  assert.ok(screen.getByText(/Ezequiel te pasó \$ 200\.000,00/));
  fireEvent.click(screen.getByRole("button", { name: "✓ Sí, la recibí" }));
  await waitFor(() => assert.deepEqual(enviados[0], { accion: "recibir", id: "pase-1" }));
  await waitFor(() => assert.equal(cambios, 1));
  fireEvent.click(screen.getByRole("button", { name: "⇄ Le pasé plata a…" }));
  fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "15.000" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 2));
  assert.deepEqual([enviados[1].accion, enviados[1].cuenta, enviados[1].hacia, enviados[1].importe], ["pasar", CAJA_MAYCO.cuenta, CAJA_EZE.cuenta, 15000]);
  await waitFor(() => assert.ok(screen.getByText(/cuando Ezequiel confirme/)));
});
