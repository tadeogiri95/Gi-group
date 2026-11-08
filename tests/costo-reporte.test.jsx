// tests/costo-reporte.test.jsx — Costo de OT, parte F: Reportes → 💲 Costo por
// OT (materiales, horas presupuestadas y reales, mano de obra y costo final;
// final de la constancia si la OT está cerrada) y exportar a Excel.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { filaReporte, totalesReporte, planillaReporte } from "../app/lib/costoReporte.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/costo-reporte/route.js");
const { _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { default: CostoOtTab } = await import("../app/components/CostoOtTab.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const horas = (p, r) => ({ total: { presupuestadas: { valor: p }, reales: { valor: r } } });

test("fila — abierta: materiales de hoy + horas reales × costo de la hora, provisorio", () => {
  const f = filaReporte({ proyecto: { ot: "M-1", cliente: "PEREZ", obra: "CASA", division: "muebles" }, fechaOt: "2026-11-02", materiales: { total: 100000, sinPrecio: 2 }, horas: horas(10, 12), costoHora: 5000 });
  assert.deepEqual([f.costo, f.materiales, f.sin_precio, f.horas_reales, f.mano_obra, f.total, f.diferencia, f.pct], ["provisorio", 100000, 2, 12, 60000, 160000, 2, 120]);
});

test("fila — cerrada con costo final: los números de la constancia, aunque hoy cambien", () => {
  const final = { materiales: 90000, sin_precio: 0, horas_persona: 8, costo_hora: 4000, mano_obra: 32000, total: 122000, detalle: { horas: [{ etapa: "total", presupuestadas: { valor: 10 } }] } };
  const f = filaReporte({ proyecto: { ot: "M-2" }, final, materiales: { total: 999999 }, horas: horas(1, 1), costoHora: 9999 });
  assert.deepEqual([f.costo, f.materiales, f.horas_presupuestadas, f.horas_reales, f.mano_obra, f.total, f.pct], ["final", 90000, 10, 8, 32000, 122000, 80]);
});

test("totales y planilla — suman lo que hay; la planilla trae encabezado, OT completa y total", () => {
  const filas = [
    filaReporte({ proyecto: { ot: "M-1", cliente: "PEREZ" }, fechaOt: "2026-11-02", materiales: { total: 100000, sinPrecio: 1 }, horas: horas(10, 12), costoHora: 5000 }),
    filaReporte({ proyecto: { ot: "M-2" }, materiales: { total: 50000.5, sinPrecio: 0 }, horas: null, costoHora: 5000 }),
  ];
  const t = totalesReporte(filas);
  assert.deepEqual([t.ots, t.materiales, t.sin_precio, t.horas_reales, t.mano_obra, t.total, t.pct], [2, 150000.5, 1, 12, 60000, 210000.5, 120]);
  const hoja = planillaReporte(filas);
  assert.equal(hoja[0][0], "OT");
  assert.equal(hoja[1][0], "OT M-1 · PEREZ");
  assert.equal(hoja[1][2], "02/11/2026");
  assert.equal(hoja[2][4], "50000,5", "números en formato argentino, sin separador de miles");
  assert.deepEqual(hoja.at(-1).slice(0, 4), ["Total", "", "", "0 de 2 finales"]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const req = async (rol, q = "desde=2026-11-01&hasta=2026-11-30") => api.GET(new Request(`http://localhost/api/costo-reporte?${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));

function mockApi({ supervisor = false } = {}) {
  const urls = [];
  _limpiarCacheAlcance();
  const vacio = (re) => ({ match: (u) => re.test(u), respond: () => ({ status: 200, body: [] }) });
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=id,solo_su_division"), respond: () => ({ status: 200, body: [{ id: EMP, solo_su_division: supervisor }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/proyectos?"), respond: (u) => { urls.push(u); return { status: 200, body: [{ ot: "M-1", cliente: "PEREZ", created_at: "2026-11-02T15:00:00Z", estado: "activo", division: "muebles" }, { ot: "M-2", created_at: "2026-11-03T15:00:00Z", estado: "cerrado" }] }; } },
    { match: (u) => u.includes("/rest/v1/costos_finales_ot?"), respond: () => ({ status: 200, body: [{ ot: "M-2", estado: "calculado", materiales: 90000, sin_precio: 0, horas_persona: 8, costo_hora: 4000, mano_obra: 32000, total: 122000, detalle: { horas: [] } }] }) },
    { match: (u) => u.includes("/rest/v1/costos_empresa?"), respond: () => ({ status: 200, body: [{ costo_hora: 5000 }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock?"), respond: (u) => { urls.push(u); return { status: 200, body: [{ ot: "M-1", sku: "A", nombre: "MELAMINA", cantidad: 2 }] }; } },
    { match: (u) => u.includes("/rest/v1/precios_fijos_ot?"), respond: () => ({ status: 200, body: [{ ot: "M-1", sku: "A", fecha: "2026-10-01", precio: 50000, precio_ars: 50000, moneda: "ARS", origen: "mrp" }] }) },
    { match: (u) => u.includes("/rest/v1/horas_ot?"), respond: () => ({ status: 200, body: [{ ot: "M-1", etapa: "total", reales: 10, presupuestadas: 8 }] }) },
    vacio(/\/rest\/v1\/(movimientos_stock|articulos_stock|etapas|divisiones|config_sistema|empleados|v_avance_piezas|avance_etapas|avance_manual_historial|pausas_ot|pasos_pieza|registro_actividades)\?/),
  ]);
  return urls;
}

test("/api/costo-reporte — solo el dueño y el supervisor; el período tiene que ser válido", async () => {
  mockApi();
  assert.equal((await req("administrativo")).status, 403);
  assert.equal((await req("operativo")).status, 403);
  assert.equal((await req("gerencial", "desde=2026-11-30&hasta=2026-11-01")).status, 400);
  mockApi({ supervisor: true });
  assert.equal((await req("administrativo")).status, 200, "supervisor");
});

test("/api/costo-reporte — OT del período por fecha de carga; la cerrada con su constancia, la abierta provisoria", async () => {
  const urls = mockApi();
  const res = await req("gerencial");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.match(urls[0], /created_at=gte\.2026-11-01T00%3A00%3A00-03%3A00&created_at=lt\.2026-12-01T00%3A00%3A00-03%3A00/);
  assert.ok(!urls.some((u) => u.includes("necesidades_stock") && u.includes("M-2")), "la cerrada no se recalcula");
  const [m1, m2] = d.filas;
  assert.deepEqual([m1.ot, m1.costo, m1.materiales, m1.horas_reales, m1.mano_obra, m1.total], ["M-1", "provisorio", 100000, 10, 50000, 150000]);
  assert.deepEqual([m2.ot, m2.costo, m2.total], ["M-2", "final", 122000]);
});

// ─── Pantalla ───

test("pestaña — totales, filtro por división y exportar", async () => {
  global.fetch = async () => Response.json({ ok: true, truncado: false, filas: [
    { ot: "M-1", cliente: "PEREZ", division: "muebles", fecha_ot: "2026-11-02", costo: "provisorio", materiales: 100000, sin_precio: 1, horas_presupuestadas: 10, horas_reales: 12, diferencia: 2, pct: 120, mano_obra: 60000, total: 160000 },
    { ot: "M-2", division: "obras", fecha_ot: "2026-11-03", costo: "final", materiales: 90000, sin_precio: 0, horas_presupuestadas: 10, horas_reales: 8, diferencia: -2, pct: 80, mano_obra: 32000, total: 122000 },
  ] });
  const divisiones = [{ id: "muebles", label: "Muebles" }, { id: "obras", label: "Obras" }];
  const { rerender } = render(<CostoOtTab fechaDesde="2026-11-01" fechaHasta="2026-11-30" labelPeriodo="Noviembre" divisiones={divisiones} division="todas" />);
  await waitFor(() => screen.getByText("Costo total de 2 OT"));
  assert.ok(screen.getByText("$ 282.000"));
  assert.ok(screen.getByText("Final"));
  assert.ok(screen.getByText("Provisorio"));
  rerender(<CostoOtTab fechaDesde="2026-11-01" fechaHasta="2026-11-30" labelPeriodo="Noviembre" divisiones={divisiones} division="obras" />);
  await waitFor(() => screen.getByText("Costo total de 1 OT"));
  let bajado = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => { bajado = b; return "blob:x"; };
  URL.revokeObjectURL = () => {};
  fireEvent.click(screen.getByText("⬇ Exportar a Excel"));
  URL.createObjectURL = orig;
  assert.ok(bajado, "bajó la planilla");
  const reportes = readFileSync(new URL("../app/reportes_screen.jsx", import.meta.url), "utf8");
  assert.match(reportes, /conCostoOt = tieneModulo\(empresa, "proyectos"\) && comoDueno\(usuario\)/);
});
