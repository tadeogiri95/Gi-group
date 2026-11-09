// tests/finanzas-libro.test.jsx — Finanzas, parte F2c: el script del libro
// baja de Gypi las operaciones (T-OPERACIONES) y los cheques (R-CHEQUES).
// El script se prueba contra una hoja de mentira con la forma del libro.
import "./helpers/domSetup.js";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { datosParaLibro, filaOperacion, filaCheque, estadoLibro, scriptLibro, generarClave, CLAVE_LIBRO_FIN } from "../app/lib/finanzasLibro.js";
import { CLAVE_LIBRO_FIN as CLAVE_PANTALLA } from "../app/components/FinanzasLibroScript.jsx";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/libro/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CUENTAS = [{ codigo: "02.01.02.001.001", nombre: "Proveedores" }, { codigo: "01.01.01.001.001.01", nombre: "Caja Principal" }, { codigo: "05.01.01", nombre: "Materias Primas" }];
const OP = {
  id: 5, fecha: "2026-11-09", tipo: "PAGO EFECTIVO", proveedor_id: 3, entidad: null, proyecto_id: 8, centro_costo: "MUEBLES",
  neto: 1000, iva: 210, otros_impuestos: 15, moneda: "ARS", cuenta_debe: "02.01.02.001.001", cuenta_haber: "01.01.01.001.001.01",
  descripcion: "Orden de pago N° 4", referencia: "OP 4", origen: "orden_pago", estado: "confirmada", cargada_por_nombre: "Tadeo", updated_at: "2026-11-09T10:00:00Z",
};
const CHEQUE = { id: 50, clase: "propio", tipo: "echeq_diferido", banco: "Credicoop", numero: "77", importe: 400000, fecha_emision: "2026-11-09", fecha_pago: "2026-12-15", proveedor_id: 3, beneficiario: "EGGER", estado: "pendiente", origen: "pago", created_at: "2026-11-09T12:00:00Z", updated_at: "2026-11-09T12:00:00Z" };

// ─── Reglas ───

test("renglón de T-OPERACIONES — cuentas por nombre, impuestos juntos, marca GY-F", () => {
  const f = filaOperacion(OP, { cuentas: new Map(CUENTAS.map((c) => [c.codigo, c.nombre])), proveedores: new Map([[3, "EGGER"]]), proyectos: new Map([[8, "M-7495"]]) });
  assert.equal(f.v, "2026-11-09T10:00:00Z");
  assert.deepEqual(f.valores, {
    fecha: "2026-11-09", usuario: "Tadeo", tipo: "PAGO EFECTIVO", entidad: "EGGER", proyecto: "M-7495", centro_costo: "MUEBLES",
    neto: 1000, impuestos: 225, moneda: "ARS", debe: "Proveedores", haber: "Caja Principal",
    descripcion: "Orden de pago N° 4 · Ref. OP 4", referencia: "GY-F-5", estado: "CONFIRMADO",
  });
});

test("renglón de R-CHEQUES — estado como el libro; los copiados del libro solo actualizan estado", () => {
  assert.deepEqual(["pendiente", "en_cartera", "entregado", "debitado", "depositado", "rechazado"].map(estadoLibro), ["ACTIVO", "ACTIVO", "ENTREGADO", "PAGADO", "PAGADO", "RECHAZADO"]);
  const f = filaCheque(CHEQUE, { empresa: "Gi amoblamientos S.R.L", proveedores: new Map() });
  assert.deepEqual([f.valores.tipo, f.valores.librador, f.valores.beneficiario, f.valores.estado, f.valores.referencia, f.valores.fecha_transac], ["E-CHEQ PAGO DIFERIDO", "Gi amoblamientos S.R.L", "EGGER", "ACTIVO", "GY-C-50", "2026-11-09"]);
  const d = datosParaLibro({
    operaciones: [OP, { ...OP, id: 6, anulada_at: "x" }, { ...OP, id: 7, origen: "saldo_inicial" }],
    cheques: [CHEQUE, { ...CHEQUE, id: 51, estado: "anulado" }, { id: 52, origen: "libro", referencia: "27", estado: "entregado", entregado_a: "ACERCO", clase: "tercero" }],
    cuentas: CUENTAS,
  });
  assert.deepEqual(d.operaciones.map((o) => o.id), [5], "ni anuladas ni saldos iniciales");
  assert.deepEqual(d.cheques.map((c) => c.id), [50]);
  assert.deepEqual(d.cheques_libro, [{ ref: "27", estado: "ENTREGADO", entregado_a: "ACERCO" }]);
  assert.equal(CLAVE_PANTALLA, CLAVE_LIBRO_FIN);
});

// ─── El script, contra una hoja de mentira ───

class Hoja {
  constructor(nombre, filas, formulas = {}) {
    this.nombre = nombre;
    this.v = filas.map((f) => [...f]);
    this.f = this.v.map((f, i) => f.map((_, j) => formulas[`${i + 1},${j + 1}`] || ""));
    this.notas = new Map();
    this.ancho = filas[0].length;
  }
  getName() { return this.nombre; }
  getMaxRows() { return this.v.length; }
  getLastColumn() { return this.ancho; }
  getLastRow() {
    for (let i = this.v.length - 1; i >= 0; i--) if (this.v[i].some((x) => x !== "") || this.f[i].some(Boolean)) return i + 1;
    return 0;
  }
  insertRowsAfter(_, n) { for (let k = 0; k < n; k++) { this.v.push(Array(this.ancho).fill("")); this.f.push(Array(this.ancho).fill("")); } }
  deleteRow(r) {
    this.v.splice(r - 1, 1); this.f.splice(r - 1, 1);
    const nuevas = new Map();
    for (const [k, val] of this.notas) { const [a, b] = k.split(",").map(Number); if (a < r) nuevas.set(k, val); else if (a > r) nuevas.set(`${a - 1},${b}`, val); }
    this.notas = nuevas;
  }
  getRange(r, c, nr = 1, nc = 1) {
    const h = this;
    const celdas = (fn) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(r + i, c + j)));
    const asegurar = (fila) => { while (h.v.length < fila) h.insertRowsAfter(0, 1); };
    return {
      getValues: () => celdas((a, b) => h.v[a - 1]?.[b - 1] ?? ""),
      getDisplayValues: () => celdas((a, b) => { const x = h.v[a - 1]?.[b - 1] ?? ""; return x instanceof Date ? x.toISOString().slice(0, 10) : String(x); }),
      getFormulas: () => celdas((a, b) => h.f[a - 1]?.[b - 1] ?? ""),
      getNotes: () => celdas((a, b) => h.notas.get(`${a},${b}`) || ""),
      setValues: (m) => { asegurar(r + nr - 1); m.forEach((fila, i) => fila.forEach((x, j) => { h.v[r + i - 1][c + j - 1] = x; h.f[r + i - 1][c + j - 1] = ""; })); },
      setValue: (x) => { h.v[r - 1][c - 1] = x; },
      setNote: (x) => { h.notas.set(`${r},${c}`, x); },
      setNotes: (m) => m.forEach((fila, i) => h.notas.set(`${r + i},${c}`, fila[0])),
      clearContent: () => celdas((a, b) => { h.v[a - 1][b - 1] = ""; h.f[a - 1][b - 1] = ""; }),
      copyTo: (dest) => dest._pegar(h.v[r - 1], h.f[r - 1]),
      _pegar: (vals, forms) => { asegurar(r + nr - 1); for (let i = 0; i < nr; i++) { h.v[r + i - 1] = [...vals]; h.f[r + i - 1] = [...forms]; } },
    };
  }
}

const TITULOS_OPS = ["C", "mes_cierre", "fecha_operación", "usuario", "cod_tipo_op", "id_entidad", "id_proyecto", "centro_costo", "banco_caja", "importe_neto", "Impuestos, retenciones y/o percepciones", "Total", "moneda", "cuenta_debe_override", "cuenta_haber_override", "nombre_debe_auto", "nombre_haber_auto", "descripcion", "referencia_externa", "estado"];
const TITULOS_CHEQUES = ["|", "fecha_transac", "fecha_emision", "tipo", "cant", "librador", "banco", "beneficiario", "Nro Cheque", "vencimiento", "monto", "estado", "dias_al_vto", "ENTREGADO A", "id_op_origen"];
const fila = (titulos, datos) => titulos.map((t) => datos[t] ?? "");

function libroDePrueba() {
  const ops = new Hoja("T-OPERACIONES", [
    TITULOS_OPS,
    fila(TITULOS_OPS, { C: 84, "fecha_operación": new Date(2025, 8, 2), cod_tipo_op: "COMPRA MP", importe_neto: 10, referencia_externa: "HORAS", estado: "CONFIRMADO" }),
    fila(TITULOS_OPS, { C: 85, "fecha_operación": new Date(2026, 10, 1), cod_tipo_op: "PAGO TRANSF", referencia_externa: "GY-F-5", estado: "CONFIRMADO" }),
    fila(TITULOS_OPS, { C: 86, "fecha_operación": new Date(2026, 10, 2), cod_tipo_op: "PAGO EFECTIVO", banco_caja: "CAJA PRINCIPAL", referencia_externa: "GY-F-6", estado: "CONFIRMADO" }),
    Array(TITULOS_OPS.length).fill(""),
  ], { "2,12": "=J2+K2", "3,12": "=J3+K3", "4,12": "=J4+K4" });
  ops.notas.set("3,19", "viejo");
  ops.notas.set("4,19", "v6");
  const cheques = new Hoja("R-CHEQUES", [
    TITULOS_CHEQUES,
    fila(TITULOS_CHEQUES, { "|": 27, vencimiento: new Date(2026, 10, 20), monto: 1000, estado: "ACTIVO" }),
  ], { "2,13": "=J2-TODAY()" });
  return { ops, cheques };
}

function correrScript(hojas, respuesta) {
  const pedidos = [];
  const globales = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: (url, o) => { pedidos.push({ url, o }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(respuesta) }; } },
    ScriptApp: {},
  };
  const codigo = scriptLibro({ url: "https://gypi.test/api/finanzas/libro", clave: "gyp_clave" });
  const fn = new Function(...Object.keys(globales), `${codigo}\nreturn pasarLibroGypi;`);
  fn(...Object.values(globales))();
  return pedidos;
}

test("script — agrega lo nuevo con las fórmulas de arriba, reescribe lo cambiado y borra lo anulado", () => {
  const { ops, cheques } = libroDePrueba();
  const respuesta = datosParaLibro({ operaciones: [OP, { ...OP, id: 7, tipo: "PAGO TRANSF", updated_at: "v7" }], cheques: [CHEQUE, { id: 52, origen: "libro", referencia: "27", estado: "debitado", clase: "propio" }], cuentas: CUENTAS });
  const pedidos = correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta);
  assert.equal(pedidos[0].o.headers.Authorization, "Bearer gyp_clave");

  const marcas = ops.v.slice(1).map((f) => f[18]).filter(Boolean);
  assert.deepEqual(marcas, ["HORAS", "GY-F-5", "GY-F-7"], "el GY-F-6 (anulado) se borró; el manual quedó");
  const r5 = ops.v[2];
  assert.equal(r5[4], "PAGO EFECTIVO", "se reescribió con el tipo nuevo");
  assert.equal(r5[0], 85, "la numeración del renglón no se toca");
  assert.equal(ops.notas.get("3,19"), "2026-11-09T10:00:00Z");
  const r7 = ops.v[3];
  assert.equal(r7[0], 86, "sigue la numeración");
  assert.ok(r7[2] instanceof Date, "la fecha va como fecha");
  assert.deepEqual([r7[9], r7[10], r7[13], r7[14], r7[19]], [1000, 225, "Proveedores", "Caja Principal", "CONFIRMADO"]);
  assert.equal(ops.f[3][11], "=J3+K3", "la fórmula del Total se copió del renglón de arriba");
  assert.equal(r7[8], "", "banco_caja del renglón de arriba no se arrastra");
  assert.equal(ops.notas.get("4,19"), "v7");

  assert.equal(cheques.v[1][11], "PAGADO", "el cheque copiado del libro cambia de estado");
  const nuevo = cheques.v[2];
  assert.deepEqual([nuevo[0], nuevo[3], nuevo[4], nuevo[10], nuevo[11], nuevo[14]], [28, "E-CHEQ PAGO DIFERIDO", 1, 400000, "ACTIVO", "GY-C-50"]);
  assert.equal(cheques.f[2][12], "=J2-TODAY()");

  // Otra pasada sin cambios: nada nuevo
  const antes = JSON.stringify([ops.v, cheques.v]);
  correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta);
  assert.equal(JSON.stringify([ops.v, cheques.v]), antes);
});

// ─── Servidor ───

test("/api/finanzas/libro — GET solo con la clave de la empresa; POST solo el Dueño", async () => {
  const { clave, hash } = generarClave(E);
  const leidas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes(`/rest/v1/config_sistema`), respond: (u, o) => (o?.method && o.method !== "GET" ? { status: 200, body: [] } : { status: 200, body: [{ clave: CLAVE_LIBRO_FIN, valor: { hash } }] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { leidas.push(u); return { status: 200, body: [OP] }; } },
    { match: (u) => u.includes("/rest/v1/fin_cheques"), respond: () => ({ status: 200, body: [CHEQUE] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [{ id: 3, nombre: "EGGER" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo" }] }) },
  ]);
  const get = (k) => api.GET(new Request("http://localhost/api/finanzas/libro", { headers: { Authorization: `Bearer ${k}` } }));
  assert.equal((await get("cualquiera")).status, 401);
  assert.equal((await get(generarClave(E).clave)).status, 401, "otra clave de la misma empresa no sirve");
  const res = await get(clave);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual([d.operaciones[0].valores.referencia, d.cheques[0].valores.referencia], ["GY-F-5", "GY-C-50"]);
  assert.match(leidas[0], /anulada_at=is\.null&origen=not\.in\.\(saldo_inicial,libro\)/);

  const tok = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
  const post = async (rol) => api.POST(new Request("http://localhost/api/finanzas/libro", { method: "POST", headers: { Authorization: `Bearer ${await tok(rol)}` }, body: "{}" }));
  assert.equal((await post("administrativo")).status, 403);
  const ok = await post("gerencial");
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).script, /function instalarLibroGypi\(\)/);
});
