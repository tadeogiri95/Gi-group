// tests/finanzas-historico.test.jsx — Finanzas: el histórico del libro en
// Gypi (apertura + renglones desde una fecha, sin duplicar). Datos inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { planHistorico, renglonesDelLibro, limpiarOperacionHistorico } from "../app/lib/finanzasHistorico.js";
import { compararCierre } from "../app/lib/finanzasCierre.js";
import { datosParaLibro } from "../app/lib/finanzasLibro.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/historico/route.js");
const { default: FinanzasHistorico } = await import("../app/components/FinanzasHistorico.jsx");

const E = "58585858-5858-5858-5858-585858585858";
const EMP = "80808080-8080-8080-8080-808080808080";
const CAJA = "01.01.01.001.001.01";
const USD = "01.01.01.008.001";
const DEU = "01.01.02.001.001";
const MP = "01.01.04.001.002";
const PROV = "02.01.02.001.001";
const AJ = "03.01.01.002.001";
const VENTAS = "04.01.01.001.001";
const GASTO = "04.02.01.001.008";
const CUENTAS = [
  { codigo: CAJA, nombre: "Caja Principal" }, { codigo: USD, nombre: "Moneda Extranjera" }, { codigo: DEU, nombre: "Deudores Por Ventas" },
  { codigo: MP, nombre: "Materias Primas" }, { codigo: PROV, nombre: "Proveedores" }, { codigo: AJ, nombre: "Ajuste De Capital" },
  { codigo: VENTAS, nombre: "Ventas Generales" }, { codigo: GASTO, nombre: "Comisiones Y Gastos Bancarios" },
];
const TES = [{ cuenta: CAJA, nombre: "Caja Principal", moneda: "ARS" }, { cuenta: USD, nombre: "Dólares", moneda: "USD" }];
const PROVEEDORES = [{ id: 7, nombre: "ACERCO SA" }];
const CLIENTES = [{ id: 5, nombre: "Sil y Rubén", alias: [], activo: true }];
const T = ["C", "mes_cierre", "fecha_operación", "usuario", "cod_tipo_op", "id_entidad", "id_proyecto", "centro_costo", "banco_caja", "importe_neto", "Impuestos, retenciones y/o percepciones", "Total", "moneda", "cuenta_debe_override", "cuenta_haber_override", "nombre_debe_auto", "nombre_haber_auto", "descripcion", "referencia_externa", "estado", "cuenta_debe_final", "cuenta_haber_final"];
const fila = (fecha, tipo, entidad, neto, imp, total, debe, haber, extra = {}) => {
  const f = Array(T.length).fill("");
  Object.assign(f, { 2: fecha, 4: tipo, 5: entidad, 9: String(neto), 10: String(imp), 11: String(total), 12: extra.moneda || "ARS", 17: extra.desc || "", 18: extra.ref || "", 19: extra.estado ?? "CONFIRMADO", 20: debe, 21: haber });
  return f;
};
const GRILLA = [
  T,
  // Antes del 01/06: arman la apertura
  fila("10/05/2026", "COBRO EFECTIVO", "SIL Y RUBEN", 1000, 0, 1000, CAJA, DEU),
  fila("11/05/2026", "VENTA", "SIL Y RUBEN", 5000, 0, 5000, DEU, VENTAS),
  fila("12/05/2026", "COMPRA MP", "ACERCO S A", 800, 0, 800, MP, PROV),
  fila("13/05/2026", "APERTURA", "", 100, 0, 100, USD, AJ, { moneda: "USD" }),
  // Desde el 01/06
  fila("02/06/2026", "PAGO GASTOS BANCARIOS", "", 50, 0, 50, GASTO, CAJA),
  fila("03/06/2026", "COMPRA MP", "ACERCO S A", 1000, 210, 1210, MP, AJ),
  fila("04/06/2026", "PAGO TRANSF", "ACERCO SA", 200, 0, 200, PROV, CAJA, { ref: "GY-F-55" }),
  fila("05/06/2026", "VENTA USD", "", 10, 0, 10, AJ, USD, { moneda: "USD" }),
  fila("06/06/2026", "", "", 30, 0, -30, GASTO, CAJA),
  fila("07/06/2026", "PAGO GASTOS BANCARIOS", "", 50, 0, 50, GASTO, CAJA),
  fila("08/06/2026", "PAGO GASTOS BANCARIOS", "", 50, 0, 50, GASTO, CAJA),
  fila("08/06/2026", "PAGO GASTOS BANCARIOS", "", 50, 0, 50, GASTO, CAJA),
  fila("09/06/2026", "PAGO GASTOS BANCARIOS", "", 999, 0, 999, GASTO, CAJA, { estado: "" }),
];
const BASE = { grilla: GRILLA, desde: "2026-06-01", cuentas: CUENTAS, tesoreria: TES, proveedores: PROVEEDORES, clientes: CLIENTES };

test("renglones del libro: solo CONFIRMADO, y los iguales con clave distinta", () => {
  const { filas } = renglonesDelLibro(GRILLA);
  assert.equal(filas.length, 12);
  const dos = filas.filter((f) => f.fecha === "2026-06-08");
  assert.equal(dos.length, 2);
  assert.notEqual(dos[0].clave, dos[1].clave);
  assert.equal(dos[1].clave, `${dos[0].clave}-2`);
  assert.equal(renglonesDelLibro(GRILLA).filas[5].clave, filas[5].clave, "la clave es estable");
  assert.ok(renglonesDelLibro([["fecha"]]).error);
});

test("plan: apertura al 31/05, operaciones desde el 01/06, Ajuste a Proveedores y dólares", () => {
  const sinTc = planHistorico(BASE);
  assert.deepEqual(sinTc.falta_tc, ["2026-06", "apertura"]);
  const p = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 } });
  assert.deepEqual(p.falta_tc, []);
  assert.equal(p.fecha_apertura, "2026-05-31");
  const ap = new Map(p.apertura.map((o) => [o.origen_id, o]));
  assert.deepEqual([...ap.keys()].sort(), ["a01.01.04.001.002", "c5", "p7", `t${CAJA}`, `t${USD}`]);
  assert.deepEqual([ap.get(`t${CAJA}`).cuenta_debe, ap.get(`t${CAJA}`).total], [CAJA, 1000]);
  assert.deepEqual([ap.get("c5").cuenta_debe, ap.get("c5").total, ap.get("c5").cliente_id], [DEU, 4000, 5]);
  assert.deepEqual([ap.get("p7").cuenta_haber, ap.get("p7").total, ap.get("p7").proveedor_id], [PROV, 800, 7]);
  assert.deepEqual([ap.get(`t${USD}`).moneda, ap.get(`t${USD}`).total, ap.get(`t${USD}`).total_ars], ["USD", 100, 100000]);
  // Desde el 01/06: sin el de Gypi ni el no confirmado
  assert.equal(p.nuevas.length, 7);
  assert.equal(p.de_gypi, 1);
  const compra = p.nuevas.find((o) => o.tipo === "COMPRA MP");
  assert.deepEqual([compra.cuenta_haber, compra.proveedor_id, compra.neto, compra.otros_impuestos, compra.total], [PROV, 7, 1000, 210, 1210]);
  assert.match(compra.descripcion, /Ajuste De Capital/);
  assert.equal(p.convertidas, 1);
  const usd = p.nuevas.find((o) => o.moneda === "USD");
  assert.deepEqual([usd.tipo_cambio, usd.total_ars], [1200, 12000]);
  const reves = p.nuevas.find((o) => o.tipo === "SIN TIPO");
  assert.deepEqual([reves.cuenta_debe, reves.cuenta_haber, reves.total], [CAJA, GASTO, 30], "total negativo = al revés");
  assert.equal(p.sin_tipo, 1);
});

test("plan: lo que ya está se saltea, lo que no está se anula, y los saldos iniciales se reemplazan", () => {
  const primero = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 } });
  const existentes = [
    ...primero.nuevas.slice(0, 3).map((o, i) => ({ id: 100 + i, origen: "libro", origen_id: o.origen_id })),
    { id: 200, origen: "libro", origen_id: "Lviejo" },
    { id: 300, origen: "saldo_inicial", origen_id: "p7" },
  ];
  const p = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 }, existentes });
  assert.equal(p.iguales, 3);
  assert.equal(p.nuevas.length, 4);
  assert.deepEqual(p.anular.sort(), [200, 300]);
  const falta = planHistorico({ ...BASE, cuentas: CUENTAS.filter((c) => c.codigo !== GASTO), tc: { apertura: 1000, "2026-06": 1200 } });
  assert.deepEqual(falta.faltan_cuentas, [GASTO]);
});

test("validar en el servidor: solo origen libro o saldo inicial, cuentas del plan, dólares con cambio", () => {
  const ctx = { codigos: new Set(CUENTAS.map((c) => c.codigo)), proveedores: new Set([7]), clientes: new Set([5]) };
  const p = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 } });
  for (const o of [...p.apertura, ...p.nuevas]) assert.equal(limpiarOperacionHistorico(o, ctx).error, undefined);
  assert.ok(limpiarOperacionHistorico({ ...p.nuevas[0], origen: "manual" }, ctx).error);
  assert.ok(limpiarOperacionHistorico({ ...p.nuevas[0], cuenta_debe: "99.99" }, ctx).error);
  assert.ok(limpiarOperacionHistorico({ ...p.nuevas.find((o) => o.moneda === "USD"), tipo_cambio: null }, ctx).error);
  assert.equal(limpiarOperacionHistorico({ ...p.nuevas[0], proveedor_id: 999 }, ctx).fila.proveedor_id, null);
});

test("lo que vino del libro no vuelve al libro, y el Cierre lo reconoce", () => {
  const p = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 } });
  const ops = p.nuevas.map((o, i) => ({ ...o, id: i + 1 }));
  assert.equal(datosParaLibro({ operaciones: [...ops, { ...ops[0], id: 99, origen: "manual" }] }).operaciones.length, 1);
  const gypi = { corte: "2026-05-31", cajas: [], proveedores: [], clientes: [], operaciones: ops };
  const r = compararCierre({ gypi, grilla: GRILLA, desde: "2026-06-01", hasta: "2026-06-30" });
  // Los renglones pasados no aparecen como "cargadas solo en el libro"
  assert.equal(r.solo_libro.length, 0);
  assert.equal(r.solo_gypi.length, 0);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
function mockApi() {
  const escrito = [];
  const parches = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: CLIENTES }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { escrito.push(...JSON.parse(o.body)); return { status: 201, body: [] }; }
        if (o?.method === "PATCH") { parches.push(decodeURIComponent(u)); return { status: 200, body: [] }; }
        return { status: 200, body: [{ id: 300, origen: "saldo_inicial", origen_id: "p7", fecha: "2026-10-31" }] };
      },
    },
  ]);
  return { escrito, parches };
}
const llamar = async (metodo, body, rol = "gerencial") => api[metodo](new Request("http://localhost/api/finanzas/historico", {
  method: metodo, headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

test("/api/finanzas/historico — solo el Dueño; lee, anula y carga", async () => {
  const { escrito, parches } = mockApi();
  assert.equal((await llamar("GET", null, "administrativo")).status, 403);
  const d = await (await llamar("GET")).json();
  assert.equal(d.existentes.length, 1);
  assert.equal(d.cuentas.length, CUENTAS.length);
  assert.equal((await llamar("POST", { accion: "anular", ids: [300, "x"] })).status, 200);
  assert.match(parches[0], /origen=in\.\(libro,saldo_inicial\).*id=in\.\(300\)/);
  const p = planHistorico({ ...BASE, tc: { apertura: 1000, "2026-06": 1200 } });
  assert.equal((await llamar("POST", { accion: "cargar", operaciones: [{ ...p.nuevas[0], origen: "manual" }] })).status, 400);
  const r = await llamar("POST", { accion: "cargar", operaciones: [...p.apertura, ...p.nuevas] });
  assert.equal(r.status, 200);
  assert.equal(escrito.length, p.apertura.length + p.nuevas.length);
  assert.ok(escrito.every((o) => o.empresa_id === E && ["libro", "saldo_inicial"].includes(o.origen)));
  assert.equal((await llamar("POST", { accion: "otra" })).status, 400);
});

// ─── Pantalla ───

test("Histórico — botón en Configuración y pide el libro", async () => {
  render(<FinanzasHistorico />);
  fireEvent.click(screen.getByRole("button", { name: "Pasar el histórico" }));
  assert.ok(screen.getByLabelText("Libro (.xlsx)"));
  assert.equal(screen.getByLabelText("Desde").value, "2026-06-01");
  assert.ok(screen.getByRole("button", { name: "Pasar" }).disabled);
});
