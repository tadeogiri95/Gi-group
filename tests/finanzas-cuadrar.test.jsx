// tests/finanzas-cuadrar.test.jsx — Finanzas: cuadrar cajas y bancos con el
// libro (13/11), el histórico que no repite lo cargado por otro lado y el
// saldo inicial que no se suma al histórico. Datos inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { cuadrarCaja, cuadrarConLibro, corteDelLibro, resumenVaciar, marcaVaciar, esMarcaVaciar } from "../app/lib/finanzasCuadrar.js";
import { anuladaAMano, planHistorico, renglonesDelLibro, sinLoYaCargado } from "../app/lib/finanzasHistorico.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/cuadrar/route.js");
const apiTesoreria = await import("../app/api/finanzas/tesoreria/route.js");
const { default: FinanzasCuadrar } = await import("../app/components/FinanzasCuadrar.jsx");

const E = "59595959-5959-5959-5959-595959595959";
const EMP = "81818181-8181-8181-8181-818181818181";
const BANCO = "01.01.01.003.002";
const PF = "01.01.01.006.001";
const DEU = "01.01.02.001.001";
const AJ = "03.01.01.002.001";
const INT = "04.01.02.002.001";
const TES = [
  { cuenta: BANCO, nombre: "Banco Credicoop", moneda: "ARS", tipo: "banco" },
  { cuenta: PF, nombre: "Plazo fijo Credicoop", moneda: "ARS", tipo: "plazo_fijo" },
];
const CUENTAS = [BANCO, PF, DEU, AJ, INT].map((codigo) => ({ codigo, nombre: codigo === AJ ? "Ajuste De Capital" : codigo === DEU ? "Deudores Por Ventas" : codigo }))
  .concat([{ codigo: "02.01.02.001.001", nombre: "Proveedores" }]);
const T = ["fecha_operación", "cod_tipo_op", "id_entidad", "importe_neto", "Total", "moneda", "descripcion", "referencia_externa", "estado", "cuenta_debe_final", "cuenta_haber_final"];
const fila = (fecha, tipo, total, debe, haber, desc = "") => [fecha, tipo, "", String(total), String(total), "ARS", desc, "", "CONFIRMADO", debe, haber];
const GRILLA = [
  T,
  fila("01/06/2026", "APERTURA", 1000, BANCO, AJ),
  fila("10/06/2026", "COBRO TRANSF", 500, BANCO, DEU),
  fila("15/06/2026", "CONSTITUCIÓN PLAZO FIJO", 300, PF, BANCO, "Operacion: 123456"),
  fila("30/07/2026", "RESCATE PLAZO FIJO", 300, BANCO, PF, "Vencimiento Plazo Fijo Operacion: 123456"),
  fila("30/07/2026", "COBRO RENDIMIENTOS FINANCIEROS", 12.5, BANCO, INT),
  fila("02/08/2026", "COBRO TRANSF", 80, BANCO, DEU),
];
const { filas } = renglonesDelLibro(GRILLA);
let sig = 1;
const deLibro = filas.map((r) => ({ id: sig++, fecha: r.fecha, tipo: r.tipo, total: r.total, total_ars: r.total, moneda: "ARS", cuenta_debe: r.debe, cuenta_haber: r.haber, origen: "libro", origen_id: r.clave }));
const op = (id, fecha, total, debe, haber, origen, extra = {}) => ({ id, fecha, tipo: extra.tipo || "X", total, total_ars: total, moneda: "ARS", cuenta_debe: debe, cuenta_haber: haber, origen, origen_id: extra.origen_id || `o${id}`, ...extra });

// ─── Comparar ───

test("Cuadrar — lo repetido sobra con su origen; lo de afuera sale tildado y lo de Gypi no", () => {
  const ops = [
    ...deLibro,
    op(101, "2026-10-31", 1000, BANCO, AJ, "saldo_inicial", { origen_id: `t${BANCO}` }), // la apertura otra vez
    op(102, "2026-07-30", 300, BANCO, PF, "plazo_fijo", { origen_id: "pf123456:r" }),
    op(103, "2026-07-30", 12.5, BANCO, INT, "plazo_fijo", { origen_id: "pf123456:i" }),
    op(104, "2026-08-01", 40, BANCO, DEU, "cobro"),
    op(105, "2026-11-10", 999, BANCO, DEU, "banco"), // después del corte: no se toca
  ];
  const r = cuadrarConLibro({ grilla: GRILLA, ops, tesoreria: TES, hoy: "2026-11-13" });
  assert.equal(r.corte, "2026-08-02");
  const banco = r.cajas.find((c) => c.cuenta === BANCO);
  assert.equal(banco.saldo_libro, 1000 + 500 - 300 + 300 + 12.5 + 80);
  assert.equal(banco.diferencia, 1000 + 300 + 12.5 + 40);
  assert.deepEqual(banco.sobran.map((s) => s.id), [102, 103, 104, 101]);
  assert.deepEqual(banco.sobran.map((s) => s.importada), [true, true, false, true]);
  assert.equal(banco.sobran[0].nombre_origen, "Plazos fijos");
  assert.equal(banco.faltan.length, 0);
  // El vencimiento repetido también sobra en la cuenta del plazo fijo, pero se anula una vez
  assert.deepEqual(r.cajas.find((c) => c.cuenta === PF).sobran.map((s) => s.id), [102]);
  assert.deepEqual(r.anulables.sort(), [101, 102, 103]);
});

test("Cuadrar — empareja por importe con fecha cercana y avisa lo que falta", () => {
  const sinCobro = deLibro.filter((o) => o.total !== 80);
  // El extracto puso el cobro dos días después y sin pasar por el libro
  const ops = [...sinCobro.filter((o) => o.total !== 500), op(201, "2026-06-12", 500, BANCO, DEU, "banco")];
  const c = cuadrarCaja({ caja: TES[0], filas, ops, corte: "2026-08-02" });
  assert.equal(c.sobran.length, 0);
  assert.deepEqual(c.faltan.map((f) => [f.fecha, f.importe]), [["2026-08-02", 80]]);
  assert.equal(c.diferencia, -80);
  // Más de 7 días: ya no es el mismo
  const lejos = cuadrarCaja({ caja: TES[0], filas, ops: [...sinCobro, op(202, "2026-08-20", 80, BANCO, DEU, "banco")], corte: "2026-08-31" });
  assert.equal(lejos.sobran.length, 1);
  assert.equal(lejos.faltan.length, 1);
});

test("Cuadrar — lo de antes del histórico va junto como apertura contra el saldo inicial", () => {
  const g = [T, fila("20/05/2026", "COBRO", 700, BANCO, DEU), fila("25/05/2026", "PAGO", 200, DEU, BANCO), fila("03/06/2026", "COBRO", 50, BANCO, DEU)];
  const f = renglonesDelLibro(g).filas;
  const ops = [op(1, "2026-05-31", 500, BANCO, AJ, "saldo_inicial", { origen_id: `t${BANCO}` }), op(2, "2026-06-03", 50, BANCO, DEU, "libro", { origen_id: f[2].clave })];
  const c = cuadrarCaja({ caja: TES[0], filas: f, ops, corte: "2026-06-30", desde: "2026-06-01" });
  assert.equal(c.diferencia, 0);
  assert.equal(c.sobran.length + c.faltan.length, 0);
  assert.equal(corteDelLibro(f, TES, "2026-06-01"), "2026-05-25");
});

// ─── El histórico no repite lo que entró por otro lado ───

test("Histórico — no pasa los renglones que ya están en Gypi con otro origen", () => {
  const otras = [
    op(102, "2026-07-30", 300, BANCO, PF, "plazo_fijo"),
    op(103, "2026-07-31", 12.5, BANCO, INT, "plazo_fijo"),
    op(104, "2026-07-30", 12.5, PF, BANCO, "banco"), // otro lado de la caja: no cuenta
  ];
  const p = planHistorico({ grilla: GRILLA, desde: "2026-06-01", cuentas: CUENTAS, tesoreria: TES, existentes: [], otras });
  assert.equal(p.error, undefined);
  assert.equal(p.ya_en_gypi, 2);
  assert.equal(p.nuevas.length, filas.length - 2);
  assert.ok(!p.nuevas.some((o) => o.total === 300 && o.cuenta_haber === PF));
  const cajas = new Map(TES.map((t) => [t.cuenta, t]));
  assert.equal(sinLoYaCargado([{ fecha: "2026-07-30", total: 300, cuenta_debe: BANCO, cuenta_haber: PF }], [op(9, "2026-08-04", 300, BANCO, PF, "banco")], cajas).yaEnGypi, 0);
});

test("Histórico — lo del libro anulado a mano en Gypi no vuelve; lo de Empezar de nuevo sí", () => {
  assert.ok(anuladaAMano("Tadeo"));
  assert.ok(anuladaAMano("Tadeo (cuadrar con el libro)"));
  assert.ok(!anuladaAMano("Gypi (histórico del libro)"));
  assert.ok(!anuladaAMano("Empezar de nuevo 13/11/2026 02:30 · Tadeo"));
  assert.ok(!anuladaAMano(null));
  const p = planHistorico({ grilla: GRILLA, desde: "2026-06-01", cuentas: CUENTAS, tesoreria: TES, existentes: [], anuladas: [filas[1].clave] });
  assert.equal(p.anuladas_en_gypi, 1);
  assert.equal(p.nuevas.length, filas.length - 1);
  assert.ok(!p.nuevas.some((o) => o.origen_id === filas[1].clave));
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
function mockApi({ conHistorico = false } = {}) {
  const parches = [];
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Tadeo" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "PATCH") { parches.push({ url: decodeURIComponent(u), body: JSON.parse(o.body) }); return { status: 200, body: [{ id: 102 }, { id: 103 }] }; }
        if (o?.method === "POST") { escrito.push(...[].concat(JSON.parse(o.body))); return { status: 201, body: [] }; }
        if (decodeURIComponent(u).includes("origen=eq.libro")) return { status: 200, body: conHistorico ? [{ id: 1, origen: "libro" }] : [] };
        return { status: 200, body: deLibro };
      },
    },
  ]);
  return { parches, escrito };
}
const llamar = async (metodo, body, rol = "gerencial", modulo = api, ruta = "cuadrar") => modulo[metodo](new Request(`http://localhost/api/finanzas/${ruta}`, {
  method: metodo, headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

test("/api/finanzas/cuadrar — solo el Dueño; lee las cajas y anula lo elegido sin borrar", async () => {
  const { parches } = mockApi();
  assert.equal((await llamar("GET", null, "administrativo")).status, 403);
  const d = await (await llamar("GET")).json();
  assert.equal(d.tesoreria.length, 2);
  assert.equal(d.operaciones.length, deLibro.length);
  assert.equal((await llamar("POST", { accion: "anular", ids: [] })).status, 400);
  assert.equal((await llamar("POST", { accion: "otra" })).status, 400);
  const r = await (await llamar("POST", { accion: "anular", ids: [102, "103", 102, -1] })).json();
  assert.equal(r.anuladas, 2);
  assert.match(parches[0].url, /anulada_at=is\.null&or=\(cuenta_debe\.in\.\(.*\)\)&id=in\.\(102,103\)$/);
  assert.equal(parches[0].body.anulada_por_nombre, "Tadeo (cuadrar con el libro)");
  assert.ok(parches[0].body.anulada_at);
});

test("Tesorería — con el histórico pasado no deja cargar saldos iniciales encima", async () => {
  const { escrito } = mockApi({ conHistorico: true });
  const r = await llamar("POST", { accion: "saldos_iniciales", fecha: "2026-06-01", filas: [{ cuenta: BANCO, saldo: 1000 }] }, "gerencial", apiTesoreria, "tesoreria");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /histórico del libro/);
  assert.equal(escrito.length, 0);
});

// ─── Empezar de nuevo ───

test("Empezar de nuevo — lo de afuera y a mano, o todo; la marca dice cuándo y quién", () => {
  const ops = [op(1, "2026-06-01", 10, BANCO, AJ, "libro"), op(2, "2026-06-02", 10, BANCO, DEU, "banco"), op(3, "2026-06-03", 10, BANCO, DEU, "manual"),
    op(4, "2026-06-04", 10, BANCO, DEU, null), op(5, "2026-06-05", 10, BANCO, DEU, "cobro"), op(6, "2026-06-06", 10, BANCO, DEU, "pago", { anulada_at: "x" })];
  const r = resumenVaciar(ops);
  assert.deepEqual(r.ids, [1, 2, 3, 4]);
  assert.equal(r.quedan, 1);
  assert.equal(r.porOrigen.find((o) => o.origen === "manual").n, 2);
  assert.deepEqual(resumenVaciar(ops, "todo").ids, [1, 2, 3, 4, 5]);
  const m = marcaVaciar("Tadeo", new Date("2026-11-13T05:30:00Z"));
  assert.equal(m, "Empezar de nuevo 13/11/2026 02:30 · Tadeo");
  assert.ok(esMarcaVaciar(m));
  assert.ok(!esMarcaVaciar("Tadeo (cuadrar con el libro)"));
});

test("/api/finanzas/cuadrar — empezar de nuevo pide lo mismo que vio la pantalla y se puede deshacer", async () => {
  const { parches } = mockApi();
  const d = await (await llamar("GET")).json();
  const esperadas = resumenVaciar(d.operaciones).ids.length;
  assert.equal((await llamar("POST", { accion: "vaciar", esperadas: esperadas + 1 })).status, 409);
  assert.equal(parches.length, 0);
  const r = await (await llamar("POST", { accion: "vaciar", esperadas })).json();
  assert.ok(r.marca.startsWith("Empezar de nuevo "));
  assert.ok(parches.every((p) => p.body.anulada_por_nombre === r.marca && p.body.anulada_at));
  assert.equal((await llamar("POST", { accion: "deshacer", marca: "otra cosa" })).status, 400);
  assert.equal((await llamar("POST", { accion: "deshacer", marca: r.marca })).status, 200);
  const ultimo = parches.at(-1);
  assert.equal(ultimo.body.anulada_at, null);
  assert.match(ultimo.url, /anulada_por_nombre=eq\.Empezar de nuevo /);
});

// ─── Pantalla ───

test("Cuadrar — botón en Configuración y pide el libro", () => {
  render(<FinanzasCuadrar />);
  fireEvent.click(screen.getByRole("button", { name: "Cuadrar" }));
  assert.ok(screen.getByLabelText("Libro (.xlsx)"));
  assert.ok(screen.getAllByRole("button", { name: "Cerrar" }).length >= 1);
});
