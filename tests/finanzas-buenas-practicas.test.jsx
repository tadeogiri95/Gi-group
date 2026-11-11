// tests/finanzas-buenas-practicas.test.jsx — Finanzas, parte 7 del plan del
// 11/11: cuentas según buenas prácticas. Contrapartidas recomendadas por tipo
// (por nombre en el plan), Ajuste De Capital no es comodín, revisión contable.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuentaPorNombre, cuentasRecomendadas, usoAjusteCapital, revisionContable } from "../app/lib/finanzasBuenasPracticas.js";
import { validarOperacion } from "../app/lib/finanzasOperaciones.js";
import { operacionesGasto } from "../app/lib/finanzasGastos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/buenas-practicas/route.js");
const { default: FinanzasBuenasPracticas } = await import("../app/components/FinanzasBuenasPracticas.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

// Nombres como los del plan de cuentas del libro
const CUENTAS = [
  { codigo: "01.01.01.001.001", nombre: "Caja", activa: true },
  { codigo: "01.01.01.003.002", nombre: "BANCO CREDICOOP CTA CTE", activa: true },
  { codigo: "01.01.02.001.001", nombre: "Deudores Por Ventas", activa: true },
  { codigo: "01.01.04.001.002", nombre: "Materias Primas", activa: true },
  { codigo: "01.02.02.001.006", nombre: "Maquinarias y herramientas- Valor Costo", activa: true },
  { codigo: "02.01.02.001.001", nombre: "Proveedores", activa: true },
  { codigo: "02.01.02.003.001", nombre: "Acreedores Varios", activa: true },
  { codigo: "02.01.03.008.001", nombre: "Impuesto IIBB A Pagar", activa: true },
  { codigo: "02.01.03.005.001", nombre: "Otros Impuestos Y Tributos A Pagar", activa: true },
  { codigo: "03.01.01.002.001", nombre: "Ajuste De Capital", activa: true },
  { codigo: "04.01.02.004.001", nombre: "Otros Ingresos", activa: true },
  { codigo: "04.02.01.001.008", nombre: "Comisiones Y Gastos Bancarios", activa: true },
  { codigo: "04.02.01.001.011", nombre: "Electricidad", activa: true },
  { codigo: "04.02.01.001.041", nombre: "Servicios Publicos", activa: true },
  { codigo: "04.02.01.001.019", nombre: "Gastos General", activa: true },
  { codigo: "04.02.01.003.001", nombre: "Egresos - Otros Impuestos", activa: true },
];
const TIPOS = [
  { codigo: "COMPRAS", nombre: "Compra con o sin factura", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", activo: true },
  { codigo: "SERVICIOS", nombre: "Servicios", cuenta_debe: "04.02.01.001.011", cuenta_haber: "01.01.01.001.001", activo: true },
  { codigo: "IMPUESTOS", nombre: "Impuestos", cuenta_debe: "04.02.01.003.001", cuenta_haber: "02.01.03.008.001", activo: true },
  { codigo: "GASTOS BANCARIOS Y FINANCIEROS", nombre: "Gastos bancarios y financieros", cuenta_debe: "04.02.01.001.008", cuenta_haber: "01.01.01.003.002", activo: true },
  { codigo: "MAQUINARIA Y HERRAMIENTAS", nombre: "Maquinaria y herramientas", cuenta_debe: "04.02.01.001.019", cuenta_haber: "02.01.02.001.001", activo: true },
  { codigo: "AJUSTE DE CAJA POSITIVO", nombre: "Ajuste de caja positivo", cuenta_debe: "01.01.01.001.001", cuenta_haber: "03.01.01.002.001", activo: true },
  { codigo: "COBRO A CLIENTES", nombre: "Cobro a clientes", cuenta_debe: "01.01.01.001.001", cuenta_haber: "01.01.02.001.001", activo: true },
  { codigo: "OTROS GASTOS", nombre: "Otros gastos", cuenta_debe: null, cuenta_haber: null, activo: true },
  { codigo: "HONORARIOS", nombre: "Honorarios", cuenta_debe: "04.02.01.001.019", cuenta_haber: "01.01.01.001.001", activo: false },
  { codigo: "APERTURA", nombre: "Apertura", cuenta_debe: "01.01.01.001.001", cuenta_haber: "03.01.01.002.001", activo: true },
];

// ─── Reglas ───

test("recomendadas — la contrapartida de una compra o un gasto es una deuda; la cuenta de gasto elegida se respeta", () => {
  const r = Object.fromEntries(cuentasRecomendadas(TIPOS, CUENTAS).map((x) => [x.codigo, x]));
  assert.deepEqual(r.COMPRAS.recomendada, { debe: "01.01.04.001.002", haber: "02.01.02.001.001" }, "Ajuste De Capital → Proveedores");
  assert.deepEqual(r.SERVICIOS.recomendada, { debe: "04.02.01.001.011", haber: "02.01.02.003.001" }, "Electricidad queda; Caja → Acreedores Varios");
  assert.equal(r.IMPUESTOS, undefined, "IIBB a pagar ya es un pasivo: no se toca");
  assert.equal(r["GASTOS BANCARIOS Y FINANCIEROS"], undefined, "contra el banco está bien");
  assert.equal(r["MAQUINARIA Y HERRAMIENTAS"].recomendada.debe, "01.02.02.001.006", "una máquina es un bien de uso, no un gasto");
  assert.equal(r["AJUSTE DE CAJA POSITIVO"].recomendada.haber, "04.01.02.004.001", "sin Faltantes y Sobrantes, Otros Ingresos");
  assert.equal(r["COBRO A CLIENTES"], undefined);
  assert.deepEqual(r["OTROS GASTOS"].recomendada, { debe: "04.02.01.001.019", haber: "02.01.02.003.001" }, "sin cuentas: se completan");
  assert.equal(r.HONORARIOS, undefined, "los apagados no");
  assert.equal(r.APERTURA, undefined, "la apertura va contra el patrimonio");
  assert.match(r.COMPRAS.motivo, /deuda con el proveedor/);
});

test("recomendadas — por nombre sin importar mayúsculas ni tildes; si la cuenta no está en el plan, no se propone", () => {
  assert.equal(cuentaPorNombre(CUENTAS, ["servicios públicos"]), "04.02.01.001.041");
  assert.equal(cuentaPorNombre(CUENTAS, ["no existe", "acreedores varios"]), "02.01.02.003.001");
  const sinProv = cuentasRecomendadas([TIPOS[0]], CUENTAS.filter((c) => c.nombre !== "Proveedores"));
  assert.deepEqual(sinProv, [], "sin Proveedores en el plan, la compra queda como estaba");
});

test("Ajuste De Capital — no va en compras, gastos ni cajas; sí en apertura, saldos y socios", () => {
  assert.match(usoAjusteCapital({ tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001" }, CUENTAS), /cuenta del patrimonio/);
  assert.match(usoAjusteCapital({ tipo: "AJUSTE DE CAJA NEGATIVO", cuenta_debe: "03.01.01.002.001", cuenta_haber: "01.01.01.001.001" }, CUENTAS), /Faltantes y Sobrantes/);
  assert.equal(usoAjusteCapital({ tipo: "APERTURA", cuenta_debe: "01.01.01.001.001", cuenta_haber: "03.01.01.002.001" }, CUENTAS), null);
  assert.equal(usoAjusteCapital({ tipo: "RETIRO SOCIO", cuenta_debe: "03.01.01.002.001", cuenta_haber: "01.01.01.001.001" }, CUENTAS), null);
  assert.equal(usoAjusteCapital({ tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", origen: "saldo_inicial" }, CUENTAS), null);
  assert.equal(usoAjusteCapital({ tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001" }, CUENTAS), null);
});

test("Ajuste De Capital — Nueva operación y Cargar gasto no lo dejan usar", () => {
  const ctx = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: [{ cuenta: "01.01.01.003.002", nombre: "Banco", tipo: "banco", moneda: "ARS", activa: true }], centros: [], proveedores: [{ id: 5, nombre: "ACERCO" }], proyectos: [] };
  const op = { fecha: "2026-11-11", tipo: "COMPRAS", proveedor_id: 5, neto: 100, cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001" };
  assert.match(validarOperacion(op, ctx).errores.join(" "), /Ajuste De Capital es una cuenta del patrimonio/);
  assert.deepEqual(validarOperacion({ ...op, cuenta_haber: "02.01.02.001.001" }, ctx).errores, []);
  const gasto = { tipo: "SERVICIOS", cuenta_gasto: "03.01.01.002.001", fecha_factura: "2026-11-11", cuenta_deuda: "02.01.02.003.001", neto: 100 };
  assert.match(operacionesGasto(gasto, ctx).errores.join(" "), /ni una cuenta del patrimonio/);
});

test("revisión — operaciones contra Ajuste De Capital por tipo, tipos sin cuentas y cuentas que faltan", () => {
  const operaciones = [
    { tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 100, origen: "manual" },
    { tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 50, total_ars: 60, origen: "manual" },
    { tipo: "SERVICIOS", cuenta_debe: "04.02.01.001.011", cuenta_haber: "03.01.01.002.001", total: 10, origen: "manual" },
    { tipo: "APERTURA", cuenta_debe: "01.01.01.001.001", cuenta_haber: "03.01.01.002.001", total: 999, origen: "manual" },
    { tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 999, origen: "saldo_inicial" },
    { tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 999, origen: "manual", anulada_at: "2026-11-01" },
    { tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "02.01.02.001.001", total: 5, origen: "factura_oc" },
  ];
  const r = revisionContable({ cuentas: CUENTAS, tipos: TIPOS, operaciones });
  assert.equal(r.ajuste.n, 3);
  assert.equal(r.ajuste.de, 6, "las anuladas no cuentan");
  assert.deepEqual(r.ajuste.por_tipo, [{ tipo: "COMPRAS", n: 2, total: 160 }, { tipo: "SERVICIOS", n: 1, total: 10 }]);
  assert.deepEqual(r.tipos_ajuste, ["COMPRAS", "AJUSTE DE CAJA POSITIVO"]);
  assert.deepEqual(r.sin_cuentas, ["OTROS GASTOS"]);
  assert.deepEqual(r.faltan.map((f) => f.sugerido), ["Faltantes y Sobrantes de Caja", "Provisión SAC A Pagar", "Provisión Vacaciones A Pagar"]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, metodo, body) => api[metodo](new Request("http://localhost/api/finanzas/buenas-practicas", {
  method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

function mockApi() {
  const escrito = [];
  const leido = [];
  const tabla = {
    fin_cuentas: CUENTAS, fin_tipos_operacion: TIPOS,
    fin_operaciones: [{ id: 1, tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 100, origen: "manual" }],
  };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => /\/rest\/v1\/fin_/.test(u),
      respond: (u, o) => {
        if (o?.method === "PATCH") { escrito.push({ url: decodeURIComponent(u), body: JSON.parse(o.body) }); return { status: 200, body: [{}] }; }
        leido.push(u);
        return { status: 200, body: tabla[u.split("/rest/v1/")[1].split("?")[0]] || [] };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/finanzas/buenas-practicas — solo el Dueño; revisa el último año y cambia solo los tipos elegidos", async () => {
  const { escrito, leido } = mockApi();
  assert.equal((await pedir("administrativo", "GET")).status, 403);
  const res = await pedir("gerencial", "GET");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.ajuste.n, 1);
  assert.equal(d.nombres["02.01.02.001.001"], "Proveedores");
  assert.ok(d.recomendadas.some((r) => r.codigo === "COMPRAS"));
  assert.ok(leido.some((u) => /fin_operaciones\?.*fecha=gte\.\d{4}-\d{2}-\d{2}&anulada_at=is\.null/.test(u)));

  assert.equal((await pedir("gerencial", "POST", { accion: "aplicar", codigos: [] })).status, 400);
  const ok = await pedir("gerencial", "POST", { accion: "aplicar", codigos: ["COMPRAS", "COBRO A CLIENTES"] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).cambiados, ["COMPRAS"], "COBRO ya estaba bien");
  assert.equal(escrito.length, 1);
  assert.match(escrito[0].url, /fin_tipos_operacion\?empresa_id=eq\..+&codigo=eq\.COMPRAS/);
  assert.deepEqual([escrito[0].body.cuenta_debe, escrito[0].body.cuenta_haber], ["01.01.04.001.002", "02.01.02.001.001"]);
});

// ─── Pantalla ───

test("Revisión contable — muestra lo que hay que mirar y aplica las cuentas tildadas", async () => {
  const revision = revisionContable({ cuentas: CUENTAS, tipos: TIPOS, operaciones: [{ tipo: "COMPRAS", cuenta_debe: "01.01.04.001.002", cuenta_haber: "03.01.01.002.001", total: 100 }] });
  const nombres = Object.fromEntries(CUENTAS.map((c) => [c.codigo, c.nombre]));
  const enviado = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { enviado.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, cambiados: JSON.parse(o.body).codigos }), { status: 200 }); }
    return new Response(JSON.stringify({ desde: "2025-11-11", ...revision, nombres }), { status: 200 });
  };
  let aplicado = false;
  render(<FinanzasBuenasPracticas onAplicado={() => { aplicado = true; }} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
  await waitFor(() => assert.ok(screen.getByText("Cuentas recomendadas para cada tipo")));
  assert.match(screen.getByLabelText("Operaciones contra Ajuste De Capital").textContent, /1 de 1 operaciones/);
  assert.match(screen.getByLabelText("Cuentas que faltan").textContent, /Faltantes y Sobrantes de Caja/);
  const compras = screen.getByLabelText("Usar las cuentas recomendadas en Compra con o sin factura");
  assert.equal(compras.checked, true);
  assert.match(compras.closest("li").textContent, /Haber: Ajuste De Capital → Proveedores/);
  fireEvent.click(screen.getByLabelText("Usar las cuentas recomendadas en Servicios"));
  fireEvent.click(screen.getByRole("button", { name: /Usar las cuentas recomendadas \(/ }));
  await waitFor(() => assert.equal(aplicado, true));
  assert.equal(enviado[0].accion, "aplicar");
  assert.ok(enviado[0].codigos.includes("COMPRAS"));
  assert.ok(!enviado[0].codigos.includes("SERVICIOS"), "el destildado no va");
});
