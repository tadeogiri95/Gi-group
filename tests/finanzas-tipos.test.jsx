// tests/finanzas-tipos.test.jsx — Finanzas, parte 2: tipos de operación
// nuevos (un tipo por renglón del flujo, la forma de pago aparte). Datos
// inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { MAPA_TIPOS, TIPOS_NUEVOS, claveTipo, formaDePago, planTipos, tipoNuevo, cuentasClave, tiposParaLibro } from "../app/lib/finanzasTipos.js";
import { flujoReal, lineaDe } from "../app/lib/finanzasFlujo.js";
import { tipoDeCompra } from "../app/lib/finanzasCompras.js";
import { datosParaLibro, scriptLibro } from "../app/lib/finanzasLibro.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/tipos/route.js");
const { default: FinanzasTipos } = await import("../app/components/FinanzasTipos.jsx");

const E = "59595959-5959-5959-5959-595959595959";
const EMP = "81818181-8181-8181-8181-818181818181";
const CAJA = "01.01.01.001.001.01";
const BANCO = "01.01.01.003.002";
const ECHEQ = "01.01.01.022.001";
const DEU = "01.01.02.001.001";
const MP = "01.01.04.001.002";
const PROV = "02.01.02.001.001";
const SUELDOS = "02.01.03.001.001";
const GASTO = "04.02.01.001.003";
const CUENTAS = [
  { codigo: CAJA, nombre: "Caja Principal" }, { codigo: BANCO, nombre: "Banco Credicoop CTA CTE" }, { codigo: ECHEQ, nombre: "Valores a Depositar - E-Cheq" },
  { codigo: DEU, nombre: "Deudores por Ventas" }, { codigo: MP, nombre: "Materias Primas" }, { codigo: PROV, nombre: "Proveedores" },
  { codigo: SUELDOS, nombre: "Sueldos a Pagar" }, { codigo: GASTO, nombre: "Fletes y Acarreos" },
];
const TES = [{ cuenta: CAJA, tipo: "caja", moneda: "ARS" }, { cuenta: BANCO, tipo: "banco", moneda: "ARS" }];

test("lista: cada tipo viejo va a uno solo, y los códigos no se repiten", () => {
  const codigos = TIPOS_NUEVOS.map((t) => claveTipo(t.codigo));
  assert.equal(new Set(codigos).size, codigos.length);
  const viejos = TIPOS_NUEVOS.flatMap((t) => t.viejos.map(claveTipo));
  assert.equal(new Set(viejos).size, viejos.length);
  assert.ok(viejos.every((v) => !codigos.includes(v)), "un tipo viejo no puede ser también uno nuevo");
  assert.equal(MAPA_TIPOS[claveTipo("Pago Gastos de Logistica")], "GASTOS DE LOGÍSTICA");
  assert.equal(MAPA_TIPOS[claveTipo("APORTES SOCIOS ")], "APORTE DE SOCIOS");
});

test("tipo nuevo: los viejos pasan, los de la lista quedan, sin tipo se adivina por las cuentas", () => {
  const ctx = { cuentas: cuentasClave(CUENTAS), cajas: new Set(TES.map((t) => t.cuenta)) };
  assert.equal(tipoNuevo({ tipo: "PAGO TRANSF" }, ctx), "PAGO A PROVEEDORES");
  assert.equal(tipoNuevo({ tipo: "COBRO EFECTIVO" }, ctx), "COBRO A CLIENTES");
  assert.equal(tipoNuevo({ tipo: "GASTOS DE LOGÍSTICA" }, ctx), "GASTOS DE LOGÍSTICA");
  assert.equal(tipoNuevo({ tipo: "INVERSIONES DESARROLLISMO" }, ctx), "INVERSIONES DESARROLLISMO");
  assert.equal(tipoNuevo({ tipo: "UN TIPO RARO" }, ctx), "UN TIPO RARO");
  assert.equal(tipoNuevo({ tipo: "", cuenta_debe: MP, cuenta_haber: PROV }, ctx), "COMPRAS");
  assert.equal(tipoNuevo({ tipo: "SIN TIPO", cuenta_debe: PROV, cuenta_haber: BANCO }, ctx), "PAGO A PROVEEDORES");
  assert.equal(tipoNuevo({ tipo: "", cuenta_debe: CAJA, cuenta_haber: DEU }, ctx), "COBRO A CLIENTES");
  assert.equal(tipoNuevo({ tipo: "", cuenta_debe: GASTO, cuenta_haber: SUELDOS }, ctx), "SUELDOS");
  assert.equal(tipoNuevo({ tipo: "", cuenta_debe: GASTO, cuenta_haber: CAJA }, ctx), "SIN TIPO");
});

test("forma de pago: sale de la caja o el banco y de la otra cuenta", () => {
  const ctx = { tesoreria: TES, cuentas: CUENTAS };
  assert.equal(formaDePago({ cuenta_debe: PROV, cuenta_haber: CAJA }, ctx), "efectivo");
  assert.equal(formaDePago({ cuenta_debe: BANCO, cuenta_haber: DEU }, ctx), "transferencia");
  assert.equal(formaDePago({ cuenta_debe: BANCO, cuenta_haber: ECHEQ }, ctx), "cheque");
  assert.equal(formaDePago({ cuenta_debe: ECHEQ, cuenta_haber: DEU }, ctx), "cheque");
  assert.equal(formaDePago({ cuenta_debe: BANCO, cuenta_haber: CAJA }, ctx), "sin_caja");
  assert.equal(formaDePago({ cuenta_debe: MP, cuenta_haber: PROV }, ctx), "sin_caja");
});

test("flujo: el tipo viejo cuenta como el nuevo, y cobros y pagos se abren por forma de pago", () => {
  assert.equal(lineaDe({ tipo: "PAGO GASTOS DE LOGÍSTICA" }, { tipos: {} }), "EGR_LOGISTICA");
  assert.equal(lineaDe({ tipo: "COBRO EFECTIVO" }, { tipos: { "COBRO EFECTIVO": "ING_EFECTIVO" } }), "ING_TRANSF");
  assert.equal(lineaDe({ tipo: "UN TIPO RARO" }, { tipos: { "UN TIPO RARO": "EGR_OTROS" } }), "EGR_OTROS");
  const ops = [
    { fecha: "2026-10-02", tipo: "COBRO EFECTIVO", total: 100, total_ars: 100, cuenta_debe: CAJA, cuenta_haber: DEU },
    { fecha: "2026-10-03", tipo: "COBRO A CLIENTES", total: 300, total_ars: 300, cuenta_debe: BANCO, cuenta_haber: DEU },
    { fecha: "2026-10-04", tipo: "DEP CHEQUE", total: 50, total_ars: 50, cuenta_debe: BANCO, cuenta_haber: ECHEQ },
    { fecha: "2026-10-05", tipo: "PAGO A PROVEEDORES", total: 80, total_ars: 80, cuenta_debe: PROV, cuenta_haber: BANCO },
  ];
  const f = flujoReal({ ops, tesoreria: TES, cuentas: CUENTAS, lineas: { tipos: {} }, meses: ["2026-10"] });
  const filas = f.monedas.ARS.filas;
  const cobros = filas.find((x) => x.tipo === "linea" && x.linea === "ING_TRANSF");
  assert.equal(cobros.nombre, "Cobros a clientes");
  assert.equal(cobros.total, 450);
  const formas = filas.filter((x) => x.tipo === "forma" && x.linea === "ING_TRANSF").map((x) => [x.nombre, x.total]);
  assert.deepEqual(formas, [["Efectivo", 100], ["Transferencia", 300], ["Cheque o e-cheq", 50]]);
  // Con una sola forma no se abre; el neto no cuenta las formas dos veces
  assert.equal(filas.filter((x) => x.tipo === "forma" && x.linea === "EGR_PROVEEDORES").length, 0);
  assert.equal(f.monedas.ARS.neto[0], 370);
});

test("plan: cuántas cambian, cuáles se adivinan, tipos a crear y a apagar, proveedores", () => {
  const tipos = [
    { codigo: "PAGO TRANSF", cuenta_debe: PROV, cuenta_haber: BANCO, activo: true },
    { codigo: "COMPRA MP", grupo: "COMPRAS", cuenta_debe: MP, cuenta_haber: PROV, activo: true },
    { codigo: "GASTOS DE LOGÍSTICA", nombre: "Gastos de logística", grupo: "GASTOS", cuenta_debe: GASTO, cuenta_haber: PROV, activo: true },
  ];
  const operaciones = [
    { id: 1, tipo: "PAGO TRANSF" }, { id: 2, tipo: "PAGO TRANSF" }, { id: 3, tipo: "COMPRA MP" },
    { id: 4, tipo: "GASTOS DE LOGÍSTICA" }, { id: 5, tipo: "", cuenta_debe: MP, cuenta_haber: PROV }, { id: 6, tipo: "SIN TIPO", cuenta_debe: GASTO, cuenta_haber: CAJA },
  ];
  const p = planTipos({ tipos, operaciones, proveedores: [{ id: 9, fin_tipo: "COMPRA MP" }, { id: 10, fin_tipo: "COMPRAS" }], cuentas: CUENTAS, tesoreria: TES });
  assert.deepEqual(p.cambios, [{ viejo: "PAGO TRANSF", nuevo: "PAGO A PROVEEDORES", operaciones: 2 }, { viejo: "COMPRA MP", nuevo: "COMPRAS", operaciones: 1 }]);
  assert.deepEqual(p.adivinadas, [{ id: 5, nuevo: "COMPRAS" }]);
  assert.equal(p.sin_tipo, 1);
  assert.equal(p.operaciones, 4);
  assert.deepEqual(p.desactivar, ["PAGO TRANSF", "COMPRA MP"]);
  assert.deepEqual(p.proveedores, [{ viejo: "COMPRA MP", nuevo: "COMPRAS", n: 1 }]);
  // Los nuevos toman las cuentas del tipo viejo; el que ya estaba completo no se toca
  const pago = p.crear.find((t) => t.codigo === "PAGO A PROVEEDORES");
  assert.deepEqual([pago.cuenta_debe, pago.cuenta_haber, pago.grupo], [PROV, BANCO, "PAGOS"]);
  assert.ok(!p.crear.some((t) => t.codigo === "GASTOS DE LOGÍSTICA"));
  // La compra automática usa COMPRAS, o el nuevo del tipo viejo del proveedor
  const despues = [...tipos.map((t) => (p.desactivar.includes(t.codigo) ? { ...t, activo: false } : t)), ...p.crear];
  assert.equal(tipoDeCompra(despues, { fin_tipo: "COMPRA MP" }).tipo.codigo, "COMPRAS");
  assert.equal(tipoDeCompra(despues, null).tipo.codigo, "COMPRAS");
  assert.equal(tipoDeCompra(tipos, null).tipo.codigo, "COMPRA MP");
});

// ─── Libro ───

test("libro: la lista va siempre; reescribir solo después de pasar en Gypi", () => {
  assert.equal(datosParaLibro({}).tipos_nuevos, undefined);
  const t = datosParaLibro({ tiposNuevos: tiposParaLibro({ reescribir: true }) }).tipos_nuevos;
  assert.equal(t.reescribir, true);
  assert.equal(t.mapa["PAGO TRANSF"], "PAGO A PROVEEDORES");
  assert.equal(t.lineas.ING_TRANSF, "Cobros a clientes");
  assert.deepEqual(t.lista.find((x) => x.codigo === "PRÉSTAMOS").signo, 0);
  assert.equal(tiposParaLibro().reescribir, false);
});

/** Hojas de mentira para correr el script del libro. */
function libroFalso(hojas) {
  const hoja = (name, rows) => ({
    name, rows,
    getName() { return this.name; },
    getLastRow() { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every((x) => x === "" || x == null)) n--; return n; },
    getLastColumn() { return Math.max(...this.rows.map((r) => r.length)); },
    getRange(r, c, nr = 1, nc = 1) {
      const h = this;
      const get = (fn) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(h.rows[r - 1 + i]?.[c - 1 + j])));
      return {
        getValues: () => get((v) => (v == null ? "" : v)),
        getValue() { return this.getValues()[0][0]; },
        getDisplayValues: () => get((v) => (v == null ? "" : String(v))),
        getFormulas: () => get(() => ""),
        setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { while (h.rows.length < r + i) h.rows.push([]); h.rows[r - 1 + i][c - 1 + j] = v; })); },
        setValue(v) { this.setValues([[v]]); },
        copyTo() {},
      };
    },
    getDataRange() { return this.getRange(1, 1, this.rows.length, this.getLastColumn()); },
    copyTo(l) { const n = hoja(`${this.name}_copia`, this.rows.map((x) => [...x])); l.sheets.push(n); return n; },
    setName(n) { this.name = n; return this; },
    clearContents() { this.rows = []; },
  });
  const avisos = [];
  const libro = {
    sheets: Object.entries(hojas).map(([n, rows]) => hoja(n, rows)),
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; },
    insertSheet(n) { const h = hoja(n, []); this.sheets.push(h); return h; },
    getSpreadsheetTimeZone: () => "America/Argentina/Buenos_Aires",
    toast: (m) => avisos.push(m),
  };
  return { libro, avisos };
}

test("script del libro: suma los tipos a dim_tipos_op y dim_flujo; reescribe una vez, con respaldo y sin cambiar cuentas", () => {
  const { libro, avisos } = libroFalso({
    "T-OPERACIONES": [
      ["C", "cod_tipo_op", "cuenta_debe_override", "cuenta_haber_override", "cuenta_debe_final", "cuenta_haber_final"],
      [1, "PAGO TRANSF", "Proveedores", "Banco Credicoop CTA CTE", PROV, BANCO],
      [2, "DEVENG SUELDO", "", "Sueldos a Pagar", GASTO, SUELDOS],
      [3, "VENTA", "", "", DEU, "04.01"],
      [4, "", "Fletes y Acarreos", "Proveedores", GASTO, PROV],
    ],
    dim_tipos_op: [["cod_tipo_op", "nombre", "grupo", "subcuenta_debe_default"], ["DEVENG SUELDO", "Devengamiento", "AJUSTES", GASTO]],
    dim_flujo: [["cod_tipo_op", "linea_flujo", "signo_esperado", "nota", "", "centro_costo", "linea_flujo"], ["PAGO TRANSF", "EGR_PROVEEDORES", -1, "", "", "NUMA", "DESARR | NUMA"], ["", "", "", "", "", "CAMPO", "DESARR | CAMPO"]],
    FLUJO_V2: [["", "Clave", "Concepto"], ["", "ING_TRANSF", "Cobros por transferencia"]],
    dim_plan_cuentas: [["codigo", "nombre"], [GASTO, "Fletes y Acarreos"], [SUELDOS, "Sueldos a Pagar"]],
  });
  const props = {};
  const PropertiesService = { getDocumentProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) };
  const Utilities = { formatDate: () => "20261110_0900" };
  const correr = new Function("PropertiesService", "Utilities", "libro", "t", `${scriptLibro({ url: "https://x", clave: "gyp_x" })}\n;gypiLibroTipos_(libro, t);`);

  // Antes de pasar en Gypi: solo suma tipos, no toca T-OPERACIONES
  correr(PropertiesService, Utilities, libro, tiposParaLibro());
  const ops = libro.getSheetByName("T-OPERACIONES");
  assert.equal(ops.rows[1][1], "PAGO TRANSF");
  const flujo = libro.getSheetByName("dim_flujo").rows;
  assert.deepEqual(flujo[2].slice(0, 3), ["COBRO A CLIENTES", "ING_TRANSF", 1]);
  assert.deepEqual(flujo[2].slice(5), ["CAMPO", "DESARR | CAMPO"], "no pisa la tabla de centros de costo");
  assert.ok(!flujo.some((f) => f[0] === "VENTA"), "lo que no mueve caja no va a dim_flujo");
  const sueldos = libro.getSheetByName("dim_tipos_op").rows.find((f) => f[0] === "SUELDOS");
  assert.deepEqual(sueldos, ["SUELDOS", "Sueldos", "SUELDOS", GASTO]);
  const filasFlujo = flujo.length;

  // Después de pasar en Gypi: respaldo, cuentas fijas y tipos nuevos; la segunda vez no hace nada
  correr(PropertiesService, Utilities, libro, tiposParaLibro({ reescribir: true }));
  correr(PropertiesService, Utilities, libro, tiposParaLibro({ reescribir: true }));
  assert.deepEqual(ops.rows.slice(1).map((f) => f[1]), ["PAGO A PROVEEDORES", "SUELDOS", "VENTA", ""]);
  assert.equal(ops.rows[2][2], "Fletes y Acarreos", "la cuenta que salía del tipo quedó escrita");
  assert.equal(ops.rows[3][2], "", "un renglón que no cambia de tipo no se toca");
  assert.equal(libro.getSheetByName("dim_flujo").rows.length, filasFlujo);
  assert.equal(libro.getSheetByName("FLUJO_V2").rows[1][2], "Cobros a clientes");
  assert.ok(libro.getSheetByName("T-OPERACIONES_bk_tipos_20261110_0900"));
  assert.ok(libro.getSheetByName("mapa_tipos").rows.some((f) => f[0] === "PAGO TRANSF" && f[1] === "PAGO A PROVEEDORES"));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /se cambiaron 2 renglones/);
  assert.equal(props.gypi_tipos_version, "1");
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
function mockApi({ config = [] } = {}) {
  const parches = [];
  const altas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: (u, o) => { if (o?.method === "POST" || o?.method === "PATCH") altas.push(["config", JSON.parse(o.body)]); return { status: 200, body: config }; } },
    {
      match: (u) => u.includes("/rest/v1/fin_tipos_operacion"),
      respond: (u, o) => {
        if (o?.method === "POST") { altas.push(["tipos", JSON.parse(o.body)]); return { status: 201, body: [] }; }
        if (o?.method === "PATCH") { parches.push(decodeURIComponent(u)); return { status: 200, body: [] }; }
        return { status: 200, body: [{ codigo: "PAGO TRANSF", cuenta_debe: PROV, cuenta_haber: BANCO, activo: true }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/proveedores"),
      respond: (u, o) => { if (o?.method === "PATCH") { parches.push(decodeURIComponent(u)); return { status: 200, body: [] }; } return { status: 200, body: [{ id: 9, fin_tipo: "COMPRA MP" }] }; },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "PATCH") { parches.push([decodeURIComponent(u), JSON.parse(o.body).tipo]); return { status: 200, body: [] }; }
        return { status: 200, body: [{ id: 1, tipo: "PAGO TRANSF" }, { id: 2, tipo: "", cuenta_debe: MP, cuenta_haber: PROV }] };
      },
    },
  ]);
  return { parches, altas };
}
const llamar = async (metodo, body, rol = "gerencial") => api[metodo](new Request("http://localhost/api/finanzas/tipos", {
  method: metodo, headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
}));

test("/api/finanzas/tipos — solo el Dueño; muestra el plan y lo pasa", async () => {
  const { parches, altas } = mockApi();
  assert.equal((await llamar("GET", null, "administrativo")).status, 403);
  const d = await (await llamar("GET")).json();
  assert.equal(d.operaciones, 2);
  assert.equal(d.adivinadas, 1);
  assert.equal(d.pasado, null);
  assert.ok(d.lista.length > 30);
  assert.equal((await llamar("POST", { accion: "otra" })).status, 400);
  const r = await (await llamar("POST", { accion: "pasar" })).json();
  assert.equal(r.ok, true);
  assert.equal(r.operaciones, 2);
  const tipos = altas.find(([k]) => k === "tipos")[1];
  assert.ok(tipos.every((t) => t.empresa_id === E));
  assert.ok(tipos.some((t) => t.codigo === "PAGO A PROVEEDORES" && t.cuenta_debe === PROV));
  assert.ok(parches.some((p) => Array.isArray(p) && /tipo=eq\.PAGO TRANSF/.test(p[0]) && p[1] === "PAGO A PROVEEDORES"));
  assert.ok(parches.some((p) => Array.isArray(p) && /id=in\.\(2\)/.test(p[0]) && p[1] === "COMPRAS"));
  assert.ok(parches.some((p) => typeof p === "string" && /proveedores\?.*fin_tipo=eq\.COMPRA MP/.test(p)));
  assert.ok(parches.some((p) => typeof p === "string" && /fin_tipos_operacion\?.*codigo=eq\.PAGO TRANSF/.test(p)));
  assert.equal(altas.find(([k]) => k === "config")[1].clave, "finanzas_tipos");
});

// ─── Pantalla ───

test("Tipos nuevos — botón en Configuración, muestra las equivalencias y pasa", async () => {
  const plan = { ...planTipos({ tipos: [], operaciones: [{ id: 1, tipo: "PAGO TRANSF" }], cuentas: CUENTAS, tesoreria: TES }), lista: TIPOS_NUEVOS, pasado: null };
  const pedidos = [];
  global.fetch = async (u, o) => {
    pedidos.push(o?.method || "GET");
    return new Response(JSON.stringify(o?.method === "POST" ? { ok: true, operaciones: 1 } : { ...plan, adivinadas: 0 }), { status: 200 });
  };
  let pasado = false;
  render(<FinanzasTipos onPasado={() => { pasado = true; }} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver y pasar" }));
  assert.ok(await screen.findByText("PAGO A PROVEEDORES"));
  assert.ok(screen.getByText("PAGO TRANSF"));
  fireEvent.click(screen.getByRole("button", { name: "Pasar a los tipos nuevos" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pedidos, ["GET", "POST"]);
  assert.equal(pasado, true);
});
