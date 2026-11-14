// tests/finanzas-libro-manual.test.jsx — etapa 7 de la auditoría de Finanzas
// integrada (14/11): Gypi libro oficial. Lo cargado a mano en el libro de
// Google queda pendiente para incorporarlo o ignorarlo. Datos inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { pendientesDelLibro, desdeManuales, sinClaves, sumarIgnorados, operacionManual, filaDe, COLUMNAS_MANUAL } from "../app/lib/finanzasLibroManual.js";
import { desdeDeExistentes } from "../app/lib/finanzasHistoricoBase.js";
import { renglonesDelLibro } from "../app/lib/finanzasHistorico.js";
import { generarClave, CLAVE_LIBRO_FIN } from "../app/lib/finanzasLibro.js";
import { pendientesFinanzas, GRUPOS_FINANZAS } from "../app/lib/finanzasInicio.js";
import { TABLAS_EXPORTAR, TABLAS_SIN_ID } from "../app/lib/exportar.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const apiLibro = await import("../app/api/finanzas/libro/route.js");
const api = await import("../app/api/finanzas/libro/manuales/route.js");
const { default: FinanzasLibroManual } = await import("../app/components/FinanzasLibroManual.jsx");

const E = "71717171-7171-7171-7171-717171717171";
const EMP = "17171717-1717-1717-1717-171717171717";
const CAJA = "01.01.01.001.001.01";
const PROV = "02.01.02.001.001";
const AJ = "03.01.01.002.001";
const GASTO = "04.02.01.001.008";
const CUENTAS = [{ codigo: CAJA, nombre: "Caja Principal" }, { codigo: PROV, nombre: "Proveedores" }, { codigo: AJ, nombre: "Ajuste De Capital" }, { codigo: GASTO, nombre: "Comisiones Y Gastos Bancarios" }];
const TES = [{ cuenta: CAJA, nombre: "Caja Principal", moneda: "ARS" }];

// Como lo manda el script: COLUMNAS_MANUAL y un renglón por renglón del libro
const r = (fecha, entidad, total, debe, haber, extra = {}) => [fecha, extra.tipo || "PAGO GASTOS BANCARIOS", entidad, "", total, 0, total, extra.moneda || "ARS", extra.desc || "", extra.ref || "", "CONFIRMADO", debe, haber];
const GRILLA = [
  COLUMNAS_MANUAL,
  r("2026-05-20", "", 10, GASTO, CAJA), // antes del Histórico
  r("2026-06-02", "", 50, GASTO, CAJA, { desc: "ya pasado con el Histórico" }),
  r("2026-06-03", "", 70, GASTO, CAJA, { ref: "GY-F-9" }), // de Gypi
  r("2026-11-10", "", 120, GASTO, CAJA, { desc: "comisión cargada a mano" }), // nuevo
  [], // no confirmado
  r("2026-11-11", "", 999, GASTO, CAJA, { desc: "ya entró por el extracto" }),
  r("2026-11-12", "", 40, GASTO, CAJA, { desc: "ignorado" }),
  r("2026-11-13", "", 25, GASTO, CAJA, { moneda: "USD", desc: "en dólares" }),
];
const clave = (fila) => renglonesDelLibro(GRILLA).filas.find((x) => x.fila === fila).clave;
const BASE = {
  cuentas: CUENTAS, tesoreria: TES, proveedores: [], clientes: [], anuladas: [],
  existentes: [
    { id: 1, origen: "saldo_inicial", origen_id: `t${CAJA}`, fecha: "2026-05-31", descripcion: "Saldo al 31/05/2026, del libro" },
    { id: 2, origen: "libro", origen_id: clave(3), fecha: "2026-06-02" },
  ],
  otras: [{ id: 80, origen: "banco", fecha: "2026-11-12", total: 999, cuenta_debe: GASTO, cuenta_haber: CAJA }],
};

test("desde — el día siguiente a la apertura del Histórico; sin Histórico, nada", () => {
  assert.equal(desdeDeExistentes(BASE.existentes), "2026-06-01");
  assert.equal(desdeDeExistentes([{ origen: "libro", fecha: "2026-07-03" }, { origen: "libro", fecha: "2026-07-01" }, { origen: "saldo_inicial", fecha: "2026-01-01", descripcion: "Saldo inicial" }]), "2026-07-01");
  assert.equal(desdeManuales({}), null);
});

test("pendientes — solo lo cargado a mano que Gypi no tiene (sin repetir lo del Histórico, lo de Gypi ni lo del extracto)", () => {
  const p = pendientesDelLibro({ grilla: GRILLA, desde: "2026-06-01", base: BASE, ignorados: [clave(8)] });
  assert.deepEqual(p.pendientes.map((o) => [o.fila, o.descripcion, o.total, o.moneda]), [[5, "comisión cargada a mano", 120, "ARS"], [9, "en dólares", 25, "USD"]]);
  assert.deepEqual(p.filas, [5, 9]);
  assert.equal(p.total, 2);
  assert.equal(p.pendientes[0].origen, "libro");
  assert.equal(p.pendientes[0].origen_id, clave(5), "la misma clave que el Histórico: si se vuelve a pasar, no se repite");
  assert.equal(filaDe({ referencia: "Libro, renglón 12" }), 12);
});

test("ignorar e incorporar — sacan de la lista; en dólares con el tipo de cambio", () => {
  const m = { pendientes: [{ origen_id: "a" }, { origen_id: "b" }], total: 7 };
  assert.deepEqual(sinClaves(m, ["a"]), { pendientes: [{ origen_id: "b" }], total: 6 });
  assert.deepEqual(sumarIgnorados(["a"], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(operacionManual({ moneda: "USD", total: 25 }, 1000), { moneda: "USD", total: 25, tipo_cambio: 1000, total_ars: 25000 });
  assert.equal(operacionManual({ moneda: "ARS", total: 9 }).total_ars, 9);
});

test("Inicio — aviso de lo cargado a mano; menú con 📗 Libro de Google y Cierre como control", () => {
  const p = pendientesFinanzas({ hoy: "2026-11-14", libroManual: 3 });
  assert.deepEqual(p.map((x) => [x.id, x.ir, x.cantidad]), [["libro_manual", "fin-libro", 3]]);
  assert.match(p[0].texto, /3 renglones cargados a mano en el libro de Google/);
  assert.ok(GRUPOS_FINANZAS.find((g) => g.id === "contabilidad").opciones.includes("fin-libro"));
  assert.deepEqual(GRUPOS_FINANZAS.find((g) => g.id === "ajustes").opciones, ["fin-config", "fin-cierre"]);
});

test("respaldo — el zip trae Finanzas, Compras, Stock, Flota y Maquinaria", () => {
  for (const t of ["fin_operaciones", "fin_cheques", "fin_cuentas", "ordenes_compra", "movimientos_stock", "articulos_stock", "vehiculos", "maquinas", "proyectos", "empleados"]) assert.ok(TABLAS_EXPORTAR.includes(t), t);
  assert.equal(new Set(TABLAS_EXPORTAR).size, TABLAS_EXPORTAR.length, "sin repetidas");
  for (const t of TABLAS_SIN_ID) assert.ok(TABLAS_EXPORTAR.includes(t), t);
  for (const t of ["config_sistema", "sesiones", "push_tokens", "invitaciones_empresa"]) assert.ok(!TABLAS_EXPORTAR.includes(t), `${t} no sale (claves y accesos)`);
});

// ─── Servidor ───

function mockBase({ valor }) {
  const estado = { valor, insertadas: [] };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (u) => u.includes("/rest/v1/config_sistema"),
      respond: (u, o) => {
        if (o?.method === "PATCH") { estado.valor = JSON.parse(o.body).valor; return { status: 200, body: [] }; }
        return { status: 200, body: [{ clave: CLAVE_LIBRO_FIN, valor: estado.valor }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/proveedores") || u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") { estado.insertadas.push(...JSON.parse(o.body)); return { status: 201, body: [] }; }
        const d = decodeURIComponent(u);
        if (d.includes("origen=in.(libro,saldo_inicial)")) return { status: 200, body: BASE.existentes };
        if (d.includes("origen=not.in.(libro,saldo_inicial)")) return { status: 200, body: BASE.otras };
        return { status: 200, body: [] };
      },
    },
    { match: (u) => u.includes("/rest/v1/"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return estado;
}

test("/api/finanzas/libro — el script manda lo cargado a mano y Gypi contesta qué pintar", async () => {
  const { clave: k, hash } = generarClave(E);
  const estado = mockBase({ valor: { hash, manuales_ignorados: [clave(8)] } });
  const post = (cuerpo, kk = k) => apiLibro.POST(new Request("http://localhost/api/finanzas/libro", { method: "POST", headers: { Authorization: `Bearer ${kk}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }));
  assert.equal((await post({ accion: "manuales", grilla: GRILLA }, generarClave(E).clave)).status, 401);
  const res = await post({ accion: "manuales", grilla: GRILLA });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual([d.revisado, d.desde, d.pendientes, d.total], [true, "2026-06-01", [5, 9], 2]);
  assert.deepEqual(estado.valor.manuales.pendientes.map((o) => o.fila), [5, 9]);
  assert.equal(estado.valor.hash, hash, "no pisa la clave");
});

const tok = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

test("/api/finanzas/libro/manuales — solo el Dueño; incorporar carga como el Histórico, ignorar no vuelve", async () => {
  const { hash } = generarClave(E);
  const p = pendientesDelLibro({ grilla: GRILLA, desde: "2026-06-01", base: BASE, ignorados: [clave(8)] });
  const estado = mockBase({ valor: { hash, manuales: { at: "2026-11-14T10:00:00Z", desde: "2026-06-01", pendientes: p.pendientes, total: 2, faltan_cuentas: [] } } });
  const llamar = async (rol, cuerpo) => (cuerpo
    ? api.POST(new Request("http://localhost/api/finanzas/libro/manuales", { method: "POST", headers: { Authorization: `Bearer ${await tok(rol)}` }, body: JSON.stringify(cuerpo) }))
    : api.GET(new Request("http://localhost/api/finanzas/libro/manuales", { headers: { Authorization: `Bearer ${await tok(rol)}` } })));
  assert.equal((await llamar("administrativo")).status, 403);
  const g = await (await llamar("gerencial")).json();
  assert.deepEqual([g.conectado, g.total, g.pendientes.length, g.cuentas[GASTO]], [true, 2, 2, "Comisiones Y Gastos Bancarios"]);
  // En dólares sin tipo de cambio no entra
  assert.equal((await llamar("gerencial", { accion: "incorporar", claves: [clave(9)] })).status, 400);
  const ok = await llamar("gerencial", { accion: "incorporar", claves: [clave(5), clave(9)], tc: { [clave(9)]: 1000 } });
  assert.equal(ok.status, 200);
  assert.deepEqual(estado.insertadas.map((o) => [o.origen, o.origen_id, o.total_ars, o.cargada_por_nombre]), [
    ["libro", clave(5), 120, "Gypi (cargado a mano en el libro de Google)"],
    ["libro", clave(9), 25000, "Gypi (cargado a mano en el libro de Google)"],
  ]);
  assert.deepEqual([estado.valor.manuales.pendientes.length, estado.valor.manuales.total], [0, 0]);
  // Ignorar
  estado.valor = { hash, manuales: { pendientes: p.pendientes, total: 2 } };
  assert.equal((await llamar("gerencial", { accion: "ignorar", claves: [clave(5)] })).status, 200);
  assert.deepEqual(estado.valor.manuales.pendientes.map((o) => o.fila), [9]);
  assert.deepEqual(estado.valor.manuales_ignorados, [clave(5)]);
  assert.equal((await llamar("gerencial", { accion: "ignorar", claves: [] })).status, 400);
});

test("pantalla — lista lo cargado a mano con Incorporar e Ignorar", async () => {
  const p = pendientesDelLibro({ grilla: GRILLA, desde: "2026-06-01", base: BASE, ignorados: [clave(8)] });
  const pedidos = [];
  global.fetch = async (url, o) => {
    if (o?.method === "POST") { pedidos.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, incorporadas: 1 }), { status: 200 }); }
    return new Response(JSON.stringify({ conectado: true, revisado_at: "2026-11-14T10:00:00Z", desde: "2026-06-01", pendientes: p.pendientes, total: 2, faltan_cuentas: [], ignorados: 1, cuentas: { [GASTO]: "Comisiones Y Gastos Bancarios", [CAJA]: "Caja Principal" } }), { status: 200 });
  };
  render(<FinanzasLibroManual />);
  assert.ok(await screen.findByText("2 renglones cargados a mano en el libro"));
  assert.ok(screen.getByText(/Gypi es el libro oficial/));
  assert.equal(screen.getAllByText(/Debe: Comisiones Y Gastos Bancarios · Haber: Caja Principal/).length, 2);
  assert.ok(screen.getByLabelText("Tipo de cambio del renglón 9"));
  fireEvent.click(screen.getAllByRole("button", { name: "Incorporar a Gypi" })[0]);
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual([pedidos[0].accion, pedidos[0].claves], ["incorporar", [clave(5)]]);
});
