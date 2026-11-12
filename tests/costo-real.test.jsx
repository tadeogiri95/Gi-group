// tests/costo-real.test.jsx — Auditoría 12/11, parte 3: costo previsto y
// real de la OT (lo retirado de más o fuera del MRP, compras sin stock,
// retrabajo, instalación y gastos de Finanzas con la OT), en el detalle, en
// la constancia del cierre y en Reportes → 💲 Costo por OT. Sin migración.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { comprasDirectas, costoPrevistoReal, esCuentaDeGasto, gastosOt, horasInstalacion, horasRetrabajo, materialesFuera, resumenReal } from "../app/lib/costoReal.js";
import { armarConstancia, htmlConstancia } from "../app/lib/costoFinal.js";
import { filaReporte, planillaReporte, totalesReporte } from "../app/lib/costoReporte.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/costo-real/route.js");
const { _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { default: CostoRealOt } = await import("../app/components/CostoRealOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const CUENTAS = [
  { codigo: "FLETES", linea_eerr: "GO_LOG_FLETES" },
  { codigo: "TERCEROS", linea_eerr: "CMV_TER" },
  { codigo: "PROV", linea_eerr: null, rubro: "PASIVO CORRIENTE", naturaleza: "H" },
  { codigo: "CAJA", linea_eerr: null, rubro: "ACTIVO CORRIENTE", naturaleza: "D" },
  { codigo: "VARIOS", linea_eerr: null, rubro: "RESULTADO NEGATIVO", naturaleza: "D" },
  { codigo: "VENTAS", linea_eerr: "ING_ENT" },
];

// ─── Reglas ───

test("retirado de más o fuera del MRP — solo lo que pasa lo necesario, con el precio fijo de la OT", () => {
  const r = materialesFuera({
    necesarios: [{ sku: "A", cantidad: 10 }, { sku: "B", cantidad: 5 }],
    movimientos: [
      { sku: "A", tipo: "consumo", cantidad: 12 },
      { sku: "A", tipo: "devolucion", cantidad: 0.5 },
      { sku: "B", tipo: "consumo", cantidad: 3 }, // menos de lo previsto: cuenta lo del MRP, no resta
      { sku: "Z", tipo: "consumo", cantidad: 2, nombre: "PEGAMENTO" },
      { sku: "Z", tipo: "consumo", cantidad: 9, anulado: true },
      { sku: "Y", tipo: "consumo", cantidad: 1 },
    ],
    fijos: [{ sku: "A", precio_ars: 1000 }, { sku: "Z", precio_ars: 250 }],
  });
  assert.deepEqual(r.filas.map((f) => [f.sku, f.cantidad, f.fueraMrp, f.subtotal]), [["A", 1.5, false, 1500], ["Z", 2, true, 500], ["Y", 1, true, null]]);
  assert.equal(r.total, 2000);
  assert.equal(r.sinPrecio, 1);
  assert.equal(r.filas[1].nombre, "PEGAMENTO");
});

test("compras para la OT sin stock — lo facturado o lo que llegó, en pesos; OC anulada o sin llegar no", () => {
  const ordenes = [{ id: 1, numero: 40, estado: "recibida", moneda: "ARS", proveedor_nombre: "Ferretería" }, { id: 2, numero: 41, estado: "recibida", moneda: "USD", tipo_cambio: 1000 }, { id: 3, numero: 42, estado: "anulada", moneda: "ARS" }];
  const r = comprasDirectas([
    { orden_id: 1, descripcion: "Tornillos", cantidad: 10, cantidad_recibida: 8, cantidad_facturada: null, precio_unitario: 100 },
    { orden_id: 1, descripcion: "Flete", cantidad: 1, cantidad_recibida: 0, cantidad_facturada: 1, precio_unitario: 5000 },
    { orden_id: 2, descripcion: "Herraje importado", cantidad: 2, cantidad_recibida: 2, precio_unitario: 3 },
    { orden_id: 1, descripcion: "Todavía no llegó", cantidad: 4, cantidad_recibida: 0, precio_unitario: 10 },
    { orden_id: 3, descripcion: "Anulada", cantidad: 1, cantidad_recibida: 1, precio_unitario: 99 },
    { orden_id: 1, sku: "1.1", descripcion: "Con artículo (va por el stock)", cantidad: 1, cantidad_recibida: 1, precio_unitario: 99 },
    { orden_id: 1, descripcion: "Sin precio", cantidad: 1, cantidad_recibida: 1, precio_unitario: null },
  ], ordenes);
  assert.deepEqual(r.filas.map((f) => [f.descripcion, f.cantidad, f.subtotal]), [["Herraje importado", 2, 6000], ["Flete", 1, 5000], ["Tornillos", 8, 800], ["Sin precio", 1, null]]);
  assert.equal(r.total, 11800);
  assert.equal(r.sinPrecio, 1);
});

test("gastos de Finanzas con la OT — el neto a cuentas de gasto; ni facturas de OC, ni sueldos, ni pagos", () => {
  assert.equal(esCuentaDeGasto(CUENTAS[0]), true);
  assert.equal(esCuentaDeGasto(CUENTAS[2]), false);
  assert.equal(esCuentaDeGasto(CUENTAS[4]), true, "sin clasificar: las de resultado deudoras");
  assert.equal(esCuentaDeGasto(CUENTAS[5]), false);
  const r = gastosOt([
    { id: 1, fecha: "2026-11-02", origen: "gasto", tipo: "flete", neto: 20000, cuenta_debe: "FLETES", cuenta_haber: "PROV", descripcion: "Flete a obra" },
    { id: 2, fecha: "2026-11-03", origen: "gasto", tipo: "flete", neto: 24200, cuenta_debe: "PROV", cuenta_haber: "CAJA", descripcion: "Pago del flete" },
    { id: 3, fecha: "2026-11-04", origen: "mi_caja", tipo: "viatico", neto: 100, moneda: "USD", tipo_cambio: 1000, cuenta_debe: "VARIOS", cuenta_haber: "CAJA", estado: "para_revisar" },
    { id: 4, fecha: "2026-11-05", origen: "factura_oc", neto: 999999, cuenta_debe: "TERCEROS", cuenta_haber: "PROV" },
    { id: 5, fecha: "2026-11-05", origen: "liquidacion", neto: 888888, cuenta_debe: "TERCEROS", cuenta_haber: "PROV" },
    { id: 6, fecha: "2026-11-06", origen: "manual", neto: 5000, cuenta_debe: "PROV", cuenta_haber: "TERCEROS", descripcion: "Nota de crédito del colocador" },
    { id: 7, fecha: "2026-11-07", origen: "sos", neto: 30000, cuenta_debe: "TERCEROS", cuenta_haber: "PROV", anulada_at: "x" },
    { id: 8, fecha: "2026-11-07", origen: "venta_ot", neto: 1000000, cuenta_debe: "CAJA", cuenta_haber: "VENTAS" },
  ], CUENTAS);
  assert.deepEqual(r.filas.map((f) => [f.id, f.importe]), [[1, 20000], [3, 100000], [6, -5000]]);
  assert.equal(r.total, 115000);
  assert.equal(r.paraRevisar, 1);
});

test("instalación y retrabajo — días × personas × 8 h; retrabajo anulado no suma", () => {
  const p = { dias_instalacion: 2.5, personas_instalacion: 3 };
  assert.deepEqual(horasInstalacion(p, { reportes: [{ fecha: "2026-11-10", empleado_id: "a" }, { fecha: "2026-11-11", empleado_id: "a" }] }), { previstas: 60, reales: 48, dias: 2, diasPrevistos: 2.5, personas: 3 });
  const sinPersonas = horasInstalacion({ dias_instalacion: 1 }, {
    reportes: [{ fecha: "2026-11-10", empleado_id: "a" }],
    colocados: [{ created_at: "2026-11-10T15:00:00Z", instalado_por: "b" }, { created_at: "2026-11-12T15:00:00Z", instalado_por: "b" }],
  });
  assert.deepEqual([sinPersonas.previstas, sinPersonas.reales, sinPersonas.dias], [8, 24, 2], "sin personas en la OT: las que reportaron o colocaron ese día");
  assert.deepEqual(horasInstalacion({}, {}), { previstas: null, reales: null, dias: 0, diasPrevistos: null, personas: null });
  assert.equal(horasRetrabajo([{ horas: 2.5 }, { horas: 4, anulado_at: "x" }, { horas: "1" }]), 3.5);
});

const MAT = { total: 700000, sinPrecio: 0, filas: [{ sku: "A", cantidad: 10 }] };
const HORAS = { total: { presupuestadas: { valor: 10 }, reales: { valor: 12 } } };

test("previsto contra real — renglón por renglón, total, % y avisos", () => {
  const c = costoPrevistoReal({
    materiales: MAT, horas: HORAS, costoHora: 5000, retrabajo: 2,
    fuera: { total: 1500, sinPrecio: 1 }, compras: { total: 11800, sinPrecio: 0 }, gastos: { total: 20000, paraRevisar: 1 },
    instalacion: { previstas: 16, reales: 24, diasPrevistos: 1 },
  });
  assert.deepEqual(c.renglones.map((f) => [f.id, f.previsto, f.real, f.diferencia]), [
    ["materiales", 700000, 700000, 0],
    ["fuera", 0, 1500, 1500],
    ["compras", 0, 11800, 11800],
    ["planta", 50000, 60000, 10000],
    ["retrabajo", 0, 10000, 10000],
    ["instalacion", 80000, 120000, 40000],
    ["gastos", 0, 20000, 20000],
  ]);
  assert.deepEqual([c.previsto, c.real, c.diferencia, c.pct], [830000, 923300, 93300, 111]);
  assert.deepEqual(c.avisos, ["1 renglón sin precio (no suma)", "1 gasto de Finanzas para revisar"]);
  assert.deepEqual(resumenReal(c), { materiales: 713300, mano_obra: 190000, gastos: 20000, total: 923300 });
  const sinHora = costoPrevistoReal({ materiales: MAT, horas: null, costoHora: null, instalacion: { previstas: null, reales: null, diasPrevistos: null } });
  assert.deepEqual([sinHora.previsto, sinHora.real], [700000, 700000]);
  assert.ok(sinHora.avisos.includes("La OT no tiene días de instalación previstos"));
  assert.ok(sinHora.avisos.some((a) => /Sin costo de la hora/.test(a)));
});

test("constancia — el costo final es el real, guarda el previsto y lo imprime", () => {
  const comparativa = costoPrevistoReal({ materiales: MAT, horas: HORAS, costoHora: 5000, retrabajo: 2, compras: { total: 11800, sinPrecio: 0 }, gastos: { total: 20000, paraRevisar: 0 } });
  const c = armarConstancia({
    materiales: MAT, horas: HORAS, costoHora: 5000,
    real: { comparativa, extras: { compras: { filas: [{ descripcion: "Flete <b>", cantidad: 1, oc_numero: 40, precio: 11800, subtotal: 11800 }], sinPrecio: 0 }, gastos: { filas: [{ id: 1, fecha: "2026-11-02", descripcion: "Colocador", importe: 20000 }] }, retrabajo: 2 } },
  });
  assert.deepEqual([c.materiales, c.mano_obra, c.total, c.horas_persona], [711800, 70000, 801800, 12]);
  assert.equal(c.detalle.comparativa.previsto, 750000);
  assert.equal(c.detalle.retrabajo_horas, 2);
  const html = htmlConstancia({ costo: { ...c, motivo: "cierre" }, otTexto: "M-7471" });
  assert.match(html, /Previsto<\/th>/);
  assert.match(html, /Compras para la OT \(sin stock\)/);
  assert.match(html, /Gastos de Finanzas con esta OT \(1\)/);
  assert.match(html, /Flete &lt;b&gt;/);
  assert.doesNotMatch(html, /Flete <b>/);
  // Una constancia vieja (sin previsto) sigue mostrándose como antes
  assert.match(htmlConstancia({ costo: armarConstancia({ materiales: MAT, horas: HORAS, costoHora: 5000 }) }), /Mano de obra: 12 h/);
});

test("reporte — costo real y previsto por OT, desvío y planilla", () => {
  const comparativa = costoPrevistoReal({ materiales: MAT, horas: HORAS, costoHora: 5000, gastos: { total: 20000, paraRevisar: 0 } });
  const abierta = filaReporte({ proyecto: { ot: "M-1" }, materiales: MAT, horas: HORAS, costoHora: 5000, comparativa });
  assert.deepEqual([abierta.costo, abierta.total, abierta.previsto, abierta.desvio, abierta.desvio_pct, abierta.gastos], ["provisorio", 780000, 750000, 30000, 104, 20000]);
  const final = filaReporte({ proyecto: { ot: "M-2" }, final: { materiales: 100, mano_obra: 50, total: 200, horas_persona: 2, detalle: { comparativa: { previsto: 160, renglones: [{ id: "gastos", real: 50 }] } } } });
  assert.deepEqual([final.costo, final.previsto, final.desvio, final.gastos], ["final", 160, 40, 50]);
  const vieja = filaReporte({ proyecto: { ot: "M-3" }, final: { materiales: 100, mano_obra: 50, total: 150, detalle: {} } });
  assert.equal(vieja.previsto, null, "constancia de antes: sin previsto");
  const t = totalesReporte([abierta, final, vieja]);
  assert.deepEqual([t.previsto, t.real_comparado, t.desvio, t.total], [750160, 780200, 30040, 780350]);
  const planilla = planillaReporte([abierta]);
  assert.deepEqual(planilla[0].slice(-9, -4), ["Gastos de la OT", "Costo final", "Costo previsto", "Desvío", "% real/previsto"]);
  assert.deepEqual(planilla[1].slice(-8, -4), ["780000", "750000", "30000", 104]);
});

// ─── Ruta ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 1, rol })).token;
}
const get = async (rol, ot = "M-7471") => api.GET(new Request(`http://localhost/api/costo-real?ot=${encodeURIComponent(ot)}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));

function mockApi({ supervisor = false } = {}) {
  _limpiarCacheAlcance();
  const leido = [];
  const fijos = [{ ot: "M-7471", sku: "A", fecha: "2026-01-01", precio: 70000, precio_ars: 70000, moneda: "ARS", origen: "mrp" }];
  const datos = {
    proyectos: [{ id: 9, ot: "M-7471", estado: "en_proceso", created_at: "2026-04-15T15:00:00Z", dias_instalacion: 1, personas_instalacion: 2 }],
    necesidades_stock: [{ ot: "M-7471", sku: "A", nombre: "MELAMINA", cantidad: 10 }],
    movimientos_stock: [{ ot: "M-7471", sku: "A", tipo: "consumo", cantidad: 11 }, { ot: "M-7471", sku: "Z", nombre: "COLA", tipo: "consumo", cantidad: 2 }],
    v_precios_articulos: [{ sku: "Z", fecha: "2026-03-01", precio: 300, moneda: "ARS", precio_ars: 300, origen: "mrp" }],
    ordenes_compra_items: [{ orden_id: 5, ot: "M-7471", sku: null, descripcion: "Vidrio a medida", cantidad: 1, cantidad_recibida: 1, precio_unitario: 45000 }],
    ordenes_compra: [{ id: 5, numero: 40, estado: "recibida", moneda: "ARS", proveedor_nombre: "Vidriería" }],
    fin_cuentas: CUENTAS,
    fin_operaciones: [{ id: 1, proyecto_id: 9, fecha: "2026-11-02", origen: "gasto", tipo: "flete", neto: 20000, cuenta_debe: "FLETES", cuenta_haber: "PROV", descripcion: "Flete a obra" }],
    retrabajos_ot: [{ ot: "M-7471", etapa: "corte", horas: 2 }],
    reportes_instalacion: [{ ot: "M-7471", fecha: "2026-11-10", empleado_id: "x" }],
    costos_empresa: [{ costo_hora: 5000 }],
    horas_ot: [{ ot: "M-7471", etapa: "total", reales: 12, presupuestadas: 10 }],
  };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=id,solo_su_division"), respond: () => ({ status: 200, body: [{ id: EMP, solo_su_division: supervisor }] }) },
    ...authPassHandlers(),
    {
      match: (u) => u.includes("/rest/v1/precios_fijos_ot"),
      respond: (u, o) => {
        if (o?.method === "POST") { fijos.push(...JSON.parse(o.body)); return { status: 201, body: [] }; }
        return { status: 200, body: fijos };
      },
    },
    {
      match: (u) => /\/rest\/v1\/[a-z_]+\?/.test(u),
      respond: (u) => {
        const tabla = /\/rest\/v1\/([a-z_]+)\?/.exec(u)[1];
        leido.push(decodeURIComponent(u));
        return { status: 200, body: datos[tabla] || [] };
      },
    },
  ]);
  return { leido, fijos };
}

test("/api/costo-real — solo el dueño y el supervisor; OT inválida no", async () => {
  mockApi();
  for (const rol of ["operativo", "administrativo"]) assert.equal((await get(rol)).status, 403, rol);
  assert.equal((await get("gerencial", "M-1,(x)")).status, 400);
  mockApi({ supervisor: true });
  assert.equal((await get("administrativo")).status, 200, "supervisor");
});

test("/api/costo-real — suma todo lo de la OT, filtra por empresa y fija el precio de lo retirado fuera del MRP", async () => {
  const { leido, fijos } = mockApi();
  const res = await get("gerencial");
  assert.equal(res.status, 200);
  const d = await res.json();
  const de = (id) => d.renglones.find((f) => f.id === id);
  assert.deepEqual([de("materiales").real, de("fuera").real, de("compras").real, de("planta").real, de("retrabajo").real, de("instalacion").previsto, de("instalacion").real, de("gastos").real],
    [700000, 70600, 45000, 60000, 10000, 80000, 80000, 20000]);
  assert.equal(d.real, 985600);
  assert.equal(d.previsto, 830000);
  assert.deepEqual(d.fuera.map((f) => [f.sku, f.cantidad, f.subtotal]), [["A", 1, 70000], ["Z", 2, 600]]);
  assert.equal(d.compras[0].descripcion, "Vidrio a medida");
  assert.equal(d.gastos[0].descripcion, "Flete a obra");
  assert.ok(fijos.some((f) => f.sku === "Z" && f.precio_ars === 300), "el precio de la cola queda fijo en la OT");
  for (const u of leido) assert.match(u, new RegExp(`empresa_id=eq\\.${E}`), u);
  assert.ok(leido.some((u) => u.includes("fin_operaciones") && u.includes("proyecto_id=in.(9)")));
});

// ─── Pantalla ───

test("💲 Costo previsto y real — tabla, lo que se pasó en rojo y el detalle de lo de afuera", async () => {
  const comparativa = costoPrevistoReal({ materiales: MAT, horas: HORAS, costoHora: 5000, compras: { total: 45000, sinPrecio: 0 }, gastos: { total: 20000, paraRevisar: 0 }, instalacion: { previstas: 16, reales: 16, diasPrevistos: 1 } });
  global.fetch = async (url) => {
    assert.match(String(url), /\/api\/costo-real\?ot=M-7471/);
    return new Response(JSON.stringify({
      ok: true, ...comparativa,
      fuera: [{ sku: "Z", nombre: "COLA", unidad: "KG", necesario: 0, retirado: 2, cantidad: 2, fueraMrp: true, subtotal: 600 }],
      compras: [{ descripcion: "Vidrio a medida", cantidad: 1, oc_numero: 40, proveedor: "Vidriería", subtotal: 45000 }],
      gastos: [{ id: 1, fecha: "2026-11-02", descripcion: "Flete a obra", importe: 20000 }],
    }), { status: 200 });
  };
  render(<CostoRealOt ot="M-7471" />);
  await screen.findByText("💲 Costo previsto y real");
  assert.ok(screen.getByText(/Se gastó .* más de lo previsto/));
  assert.ok(screen.getByText("Compras para la OT (sin stock)"));
  assert.ok(screen.getByText("Gastos de Finanzas con esta OT"));
  assert.ok(screen.getByText(/10 h previstas · 12 h reales/));
  fireEvent.click(screen.getByText(/Ver qué suma fuera de lo previsto/));
  assert.ok(screen.getByText(/COLA: 2 KG sin estar en el MRP/));
  assert.ok(screen.getByText(/Vidrio a medida · 1 · OC N° 40 · Vidriería/));
  assert.ok(screen.getByText(/02\/11\/2026 · Flete a obra/));
});
