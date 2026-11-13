// tests/finanzas-planilla-caja.test.jsx — Parte 7 del plan de Tesorería
// (13/11): una caja se pone al día con una planilla (Fecha, Concepto,
// Ingreso, Egreso), con la misma pantalla y las mismas reglas que el extracto.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { PLANILLA_EJEMPLO, grillaDeCsv, movimientosDeGrilla } from "../app/lib/finanzasExtracto.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/banco/route.js");
const { default: SubirExtracto } = await import("../app/components/FinanzasExtracto.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CAJA = "01.01.01.001.001";
const PF = "01.01.01.005.001";

test("planilla de ejemplo — se lee con Fecha, Concepto, Ingreso y Egreso", () => {
  const { movimientos, error } = movimientosDeGrilla(grillaDeCsv(PLANILLA_EJEMPLO));
  assert.equal(error, undefined);
  assert.deepEqual(movimientos.map((m) => [m.fecha, m.importe]), [["2026-11-03", 150000], ["2026-11-04", -12500], ["2026-11-05", -30000]]);
  assert.equal(movimientos[0].descripcion, "Cobro en efectivo Cliente SA");
  assert.match(movimientosDeGrilla([["Algo", "Otro"]]).error, /Concepto/);
});

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const subir = async (cuenta, texto) => {
  const form = new FormData();
  form.append("cuenta", cuenta);
  form.append("file", new File([texto], "caja.csv", { type: "text/csv" }));
  return api.POST(new Request("http://localhost/api/finanzas/banco", { method: "POST", headers: { Authorization: `Bearer ${await token("gerencial")}` }, body: form }));
};

function mockApi() {
  const leidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_tesoreria"),
      respond: (u) => {
        const q = decodeURIComponent(u);
        if (q.includes(`cuenta=eq.${CAJA}`)) return { status: 200, body: [{ cuenta: CAJA, nombre: "Caja chica", tipo: "caja", moneda: "ARS" }] };
        if (q.includes(`cuenta=eq.${PF}`)) return { status: 200, body: [{ cuenta: PF, nombre: "Plazo fijo", tipo: "plazo_fijo", moneda: "ARS" }] };
        return { status: 200, body: [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/fin_cheques"), respond: (u) => { leidos.push("cheques"); return { status: 200, body: [{ id: 1, clase: "tercero", estado: "en_cartera", numero: "9", fecha_pago: "2026-11-01", importe: 150000 }] }; } },
    { match: (u) => u.includes("/rest/v1/fin_ordenes_pago"), respond: () => { leidos.push("ordenes"); return { status: 200, body: [] }; } },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return leidos;
}

test("/api/finanzas/banco — una caja con su planilla: sin buscar cheques ni órdenes (esos van por el banco)", async () => {
  const leidos = mockApi();
  const r = await subir(CAJA, PLANILLA_EJEMPLO);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.filas.length, 3);
  assert.deepEqual(d.filas.map((f) => f.pendiente), [null, null, null], "el cheque en cartera no se ofrece en una caja");
  assert.deepEqual(leidos, []);
  assert.equal((await subir(PF, PLANILLA_EJEMPLO)).status, 400, "un plazo fijo no se pone al día con planilla");
});

test("pantalla — en una caja es Subir planilla, con la planilla de ejemplo", async () => {
  const respuesta = {
    ok: true, desde: "2026-11-03", hasta: "2026-11-05", reglas: 0, control: null, sin_banco: [{ id: 9, fecha: "2026-11-04", tipo: "GASTO", total: 5, cuenta_debe: "x", cuenta_haber: CAJA }],
    filas: [{ fecha: "2026-11-03", comprobante: null, descripcion: "Cobro en efectivo", importe: 150000, marca: "m1", op: null, ya: false, sugerencia: null }],
  };
  global.fetch = async (url, o = {}) => (o.body instanceof FormData ? new Response(JSON.stringify(respuesta), { status: 200 }) : new Response(JSON.stringify({ cargas: [] }), { status: 200 }));
  const creados = [];
  const crear = URL.createObjectURL;
  URL.createObjectURL = (b) => { creados.push(b); return "blob:x"; };
  URL.revokeObjectURL = () => {};
  try {
    render(<SubirExtracto caja={{ cuenta: CAJA, nombre: "Caja chica", tipo: "caja" }} datos={{ cuentas: [], tipos: [] }} onCerrar={() => {}} onCargado={() => {}} />);
    assert.ok(screen.getByText("📥 Planilla de Caja chica"));
    fireEvent.click(screen.getByRole("button", { name: /Planilla de ejemplo/ }));
    assert.equal(creados.length, 1);
    assert.match(await creados[0].text(), /Fecha;Concepto;Ingreso;Egreso/);
    fireEvent.change(screen.getByLabelText("Archivo de la planilla"), { target: { files: [new File(["x"], "caja.csv")] } });
    await screen.findByText(/En Gypi pero no en la planilla/);
    assert.ok(screen.getByText(/Movimiento de la planilla/));
    assert.ok(screen.getByText(/cómo cargás esta caja/));
  } finally {
    URL.createObjectURL = crear;
  }
});
