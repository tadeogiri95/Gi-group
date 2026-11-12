// tests/finanzas-corregir.test.jsx — Corregir o anular un movimiento de cajas
// y bancos, y los plazos fijos que quedaron dos veces (pedido del 12/11).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { operacionCorregida, plazosRepetidos, puedeAnular, puedeCorregir, dondeSeCambia } from "../app/lib/finanzasCorregir.js";
import { estadoDePlazos } from "../app/lib/finanzasPlazosFijos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/operaciones/route.js");
const apiPf = await import("../app/api/finanzas/plazos-fijos/route.js");
const { Detalle } = await import("../app/components/FinanzasMovimientos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const BANCO = "01.01.01.003.002";
const PF = "01.01.01.006.001";
const INT = "04.01.02.002.001";
const CAJA = "01.01.01.001.001.01";
const CUENTAS = [
  { codigo: BANCO, nombre: "Banco Credicoop CTA CTE", activa: true }, { codigo: PF, nombre: "Plazo Fijo Credicoop", activa: true },
  { codigo: INT, nombre: "Intereses Ganados", activa: true }, { codigo: CAJA, nombre: "Caja Principal", activa: true },
  { codigo: "05.01", nombre: "Gastos bancarios", activa: true }, { codigo: "01.01.03.001.001", nombre: "IVA Credito Fiscal", activa: true },
];

const manual = { id: 7, fecha: "2026-11-05", tipo: "PAGO GASTOS BANCARIOS", neto: 1000, iva: 210, otros_impuestos: 0, total: 1210, total_ars: 1210, moneda: "ARS", cuenta_debe: "05.01", cuenta_haber: BANCO, descripcion: "Comisión", origen: "manual" };

test("qué se corrige y qué se anula acá", () => {
  for (const origen of ["manual", "plazo_fijo", "banco", "mi_caja"]) assert.ok(puedeCorregir({ origen }), origen);
  assert.ok(puedeAnular({ origen: "gasto" }) && !puedeCorregir({ origen: "gasto" }), "el gasto se anula con su pago, no se corrige");
  for (const origen of ["factura_oc", "cheque", "orden_pago", "venta_ot", "libro", "saldo_inicial"]) assert.ok(!puedeAnular({ origen }), origen);
  assert.ok(!puedeCorregir({ origen: "manual", anulada_at: "2026-11-06" }), "la anulada no");
  assert.match(dondeSeCambia({ origen: "libro" }), /libro.*histórico/);
  assert.match(dondeSeCambia({ origen: "cheque" }), /Cheques/);
});

test("operacionCorregida — la nueva con lo cambiado; el IVA sigue la proporción", () => {
  const { nueva, errores } = operacionCorregida(manual, { fecha: "2026-11-04", total: 2420, cuenta_haber: CAJA }, { cuentas: CUENTAS });
  assert.deepEqual(errores, []);
  assert.equal(nueva.fecha, "2026-11-04");
  assert.equal(nueva.total, 2420);
  assert.equal(nueva.iva, 420);
  assert.equal(nueva.neto, 2000);
  assert.equal(nueva.total_ars, 2420);
  assert.equal(nueva.cuenta_haber, CAJA);
  assert.equal(nueva.descripcion, "Comisión");
  assert.equal(nueva.origen, "manual");
  assert.equal(nueva.origen_id, null);
  // Un plazo fijo corregido deja de ser de Gypi (no choca con su clave) pero sigue nombrando el certificado
  const pf = { ...manual, iva: 0, neto: 1000, total: 1000, origen: "plazo_fijo", origen_id: "pf123:r", descripcion: "Vencimiento de plazo fijo · Operacion: 123" };
  assert.equal(operacionCorregida(pf, { total: 999 }, { cuentas: CUENTAS }).nueva.origen, "manual");
  assert.equal(operacionCorregida({ ...manual, origen: "mi_caja" }, { total: 5 }, { cuentas: CUENTAS }).nueva.origen, "mi_caja", "Mi caja sigue en Mi caja");
  // Errores
  assert.match(operacionCorregida(manual, {}, { cuentas: CUENTAS }).errores[0], /No cambiaste nada/);
  assert.match(operacionCorregida(manual, { total: 0 }, { cuentas: CUENTAS }).errores.join(" "), /mayor a cero/);
  assert.match(operacionCorregida(manual, { cuenta_debe: BANCO }, { cuentas: CUENTAS }).errores.join(" "), /misma cuenta/);
  assert.match(operacionCorregida(manual, { cuenta_debe: "99" }, { cuentas: CUENTAS }).errores.join(" "), /no está en el plan/);
  assert.match(operacionCorregida({ ...manual, origen: "libro" }, { total: 5 }, { cuentas: CUENTAS }).errores[0], /no se corrige/);
  const usd = { ...manual, iva: 0, neto: 100, total: 100, moneda: "USD", tipo_cambio: 1000, total_ars: 100000 };
  assert.equal(operacionCorregida(usd, { total: 50, tipo_cambio: 1200 }, { cuentas: CUENTAS }).nueva.total_ars, 60000);
});

// Lo que pasó en GI: Gypi registró el vencimiento y el interés, y en el libro
// estaban cargados aparte el capital rescatado y los intereses.
const OPS_PF = [
  { id: 1, fecha: "2026-11-02", tipo: "PLAZO FIJO", total: 5777788.72, cuenta_debe: BANCO, cuenta_haber: PF, origen: "plazo_fijo", origen_id: "pf17415168:r", descripcion: "Vencimiento de plazo fijo · Operacion: 17415168" },
  { id: 2, fecha: "2026-11-02", tipo: "RENDIMIENTOS FINANCIEROS", total: 257958.48, cuenta_debe: BANCO, cuenta_haber: INT, origen: "plazo_fijo", origen_id: "pf17415168:i", descripcion: "Intereses del plazo fijo · Operacion: 17415168" },
  { id: 3, fecha: "2026-11-02", tipo: "RESCATE PLAZO FIJO", total: 5777788.72, cuenta_debe: BANCO, cuenta_haber: PF, origen: "libro", descripcion: "Vencimiento Plazo Fijo (Exento) Operacion: 17415168 - Circular: 037" },
  { id: 4, fecha: "2026-11-03", tipo: "COBRO RENDIMIENTOS FINANCIEROS", total: 257958.5, cuenta_debe: BANCO, cuenta_haber: INT, origen: "libro", descripcion: "" },
  // Otro interés del mismo día que no está repetido
  { id: 5, fecha: "2026-11-02", tipo: "COBRO RENDIMIENTOS FINANCIEROS", total: 22879.42, cuenta_debe: BANCO, cuenta_haber: INT, origen: "libro" },
  // Uno ya anulado no cuenta
  { id: 6, fecha: "2026-11-02", tipo: "PLAZO FIJO", total: 5777788.72, cuenta_debe: BANCO, cuenta_haber: PF, origen: "plazo_fijo", origen_id: "pf9:r", anulada_at: "2026-11-05" },
];

test("plazosRepetidos — cada operación de Gypi con su igual del libro (mismas cuentas, importe y fecha cercana)", () => {
  const pares = plazosRepetidos(OPS_PF);
  assert.deepEqual(pares.map((p) => [p.gypi.id, p.otra.id]), [[1, 3], [2, 4]]);
  assert.deepEqual(plazosRepetidos(OPS_PF.filter((o) => o.id !== 3 && o.id !== 4)), [], "sin la del libro no hay repetidas");
});

test("estadoDePlazos — el rescate del libro sin certificado se reconoce por el capital y la fecha", () => {
  const plazo = { certificado: "17529123", depositado: 1410199.31, interes: 22879.42, vencimiento: "2026-11-02" };
  const libro = [
    { id: 10, fecha: "2026-11-02", tipo: "RESCATE PLAZO FIJO", total: 1410199.31, cuenta_debe: BANCO, cuenta_haber: PF, origen: "libro", descripcion: "Rescate" },
    { id: 11, fecha: "2026-11-04", tipo: "COBRO RENDIMIENTOS FINANCIEROS", total: 22879.9, cuenta_debe: BANCO, cuenta_haber: INT, origen: "libro" },
  ];
  const e = estadoDePlazos([plazo], libro, [PF]).get("17529123");
  assert.equal(e.r?.id, 10);
  assert.equal(e.i?.id, 11, "el interés con centavos de diferencia y dos días después");
  // Un rescate que nombra otro certificado no se confunde
  const otro = [{ ...libro[0], descripcion: "Vencimiento Operacion: 17000000" }];
  assert.equal(estadoDePlazos([plazo], otro, [PF]).get("17529123").r, null);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const pedir = async (mod, ruta, rol, metodo, body) => mod[metodo](new Request(`http://localhost/api/finanzas/${ruta}`, {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi({ op = manual, ops = OPS_PF, falla = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: BANCO, nombre: "Banco Credicoop CTA CTE", tipo: "banco", moneda: "ARS", activa: true }, { cuenta: PF, nombre: "Plazo Fijo Credicoop", tipo: "plazo_fijo", moneda: "ARS", activa: true }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ url: decodeURIComponent(u), metodo: o.method, body });
          if (o.method === "POST" && falla) return { status: 500, body: { message: "se cortó" } };
          return { status: 201, body: [{ id: 99, ...body }] };
        }
        if (/[?&]id=eq\./.test(u)) return { status: 200, body: op ? [op] : [] };
        return { status: 200, body: ops };
      },
    },
  ]);
  return { escrito };
}

test("/api/finanzas/operaciones corregir — anula la vieja como corregida y carga la nueva", async () => {
  const { escrito } = mockApi();
  const res = await pedir(api, "operaciones", "gerencial", "POST", { accion: "corregir", id: 7, cambios: { total: 2420 } });
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, /id=eq\.7&empresa_id=eq\..+&anulada_at=is\.null/);
  assert.equal(escrito[0].body.anulada_por_nombre, "Tadeo (corregida)");
  assert.equal(escrito[1].metodo, "POST");
  assert.equal(escrito[1].body.total, 2420);
  assert.equal(escrito[1].body.empresa_id, E);
  assert.equal(escrito[1].body.cargada_por_nombre, "Tadeo");
  // Si la nueva no se guarda, la vieja vuelve a estar viva
  const fallo = mockApi({ falla: true });
  assert.equal((await pedir(api, "operaciones", "gerencial", "POST", { accion: "corregir", id: 7, cambios: { total: 2420 } })).status, 500);
  assert.equal(fallo.escrito.at(-1).metodo, "PATCH");
  assert.equal(fallo.escrito.at(-1).body.anulada_at, null);
  // Lo copiado del libro no se corrige acá, ni lo de una factura
  mockApi({ op: { ...manual, origen: "libro" } });
  assert.equal((await pedir(api, "operaciones", "gerencial", "POST", { accion: "corregir", id: 7, cambios: { total: 1 } })).status, 400);
  // Solo el Dueño
  const nadie = mockApi();
  assert.equal((await pedir(api, "operaciones", "administrativo", "POST", { accion: "corregir", id: 7, cambios: { total: 1 } })).status, 403);
  assert.equal(nadie.escrito.length, 0);
});

test("/api/finanzas/operaciones anular — ahora también plazos fijos, extracto y Mi caja; nunca lo de una factura", async () => {
  const { escrito } = mockApi();
  assert.equal((await pedir(api, "operaciones", "gerencial", "POST", { accion: "anular", id: 7 })).status, 200);
  assert.match(escrito[0].url, /origen=in\.\(manual,plazo_fijo,banco,mi_caja,fci,titulos\)/);
  const varias = mockApi();
  assert.equal((await pedir(api, "operaciones", "gerencial", "POST", { accion: "anular_varias", ids: [1, 2, 2] })).status, 200);
  assert.match(varias.escrito[0].url, /id=in\.\(1,2\)/);
  assert.match(varias.escrito[0].url, /origen=in\.\(manual,plazo_fijo/);
});

test("/api/finanzas/plazos-fijos — muestra los repetidos y anula solo las de Gypi", async () => {
  mockApi();
  const res = await pedir(apiPf, "plazos-fijos", "gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.repetidos.map((r) => [r.id, r.otra.id, r.otra.origen]), [[1, 3, "copiada del libro"], [2, 4, "copiada del libro"]]);
  const { escrito } = mockApi();
  const r2 = await pedir(apiPf, "plazos-fijos", "gerencial", "POST", { accion: "anular_repetidos" });
  assert.equal(r2.status, 200);
  assert.equal(escrito.length, 1);
  assert.match(escrito[0].url, /origen=eq\.plazo_fijo&anulada_at=is\.null&id=in\.\(1,2\)/);
  assert.equal(escrito[0].body.anulada_por_nombre, "Tadeo (repetida con el libro)");
});

// ─── Pantalla ───

const DATOS = { tipos: [{ codigo: "PAGO GASTOS BANCARIOS", activo: true }], cuentas: CUENTAS, tesoreria: [] };

test("Detalle — ✏ Corregir abre el formulario y manda lo cambiado", async () => {
  const pedidos = [];
  global.fetch = async (u, o) => { pedidos.push({ u: String(u), body: JSON.parse(o.body) }); return new Response(JSON.stringify({ ok: true, operacion: { id: 99 } }), { status: 200 }); };
  let listo = 0;
  render(<Detalle op={manual} datos={DATOS} onCerrar={() => {}} onAnulada={() => { listo += 1; }} />);
  fireEvent.click(screen.getByRole("button", { name: "✏ Corregir" }));
  const importe = screen.getByLabelText("Importe");
  assert.equal(importe.value, "1210");
  fireEvent.change(importe, { target: { value: "1.452,00" } });
  fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "Comisión de octubre" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar corrección" }));
  await waitFor(() => assert.equal(listo, 1));
  assert.equal(pedidos[0].body.accion, "corregir");
  assert.equal(pedidos[0].body.cambios.total, 1452);
  assert.equal(pedidos[0].body.cambios.descripcion, "Comisión de octubre");
});

test("Detalle — lo del libro dice dónde se corrige; la corregida dice quién la corrigió", () => {
  render(<Detalle op={{ ...manual, origen: "libro" }} datos={DATOS} onCerrar={() => {}} onAnulada={() => {}} />);
  assert.equal(screen.queryByRole("button", { name: "✏ Corregir" }), null);
  assert.equal(screen.queryByRole("button", { name: "Anular operación" }), null);
  assert.ok(screen.getByText(/Se cambia o se anula desde el libro/));
  cleanup();
  render(<Detalle op={{ ...manual, origen: "plazo_fijo", anulada_at: "2026-11-12T10:00:00Z", anulada_por_nombre: "Tadeo (corregida)" }} datos={DATOS} onCerrar={() => {}} onAnulada={() => {}} />);
  assert.ok(screen.getByText(/Corregida por Tadeo/));
  assert.ok(screen.getByText(/Plazos fijos/), "dice de dónde salió");
});
