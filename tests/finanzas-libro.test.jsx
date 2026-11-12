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

// Una regla de lista desplegable de mentira (como DataValidation de Apps Script)
const regla = (lista, allowInvalid = false) => ({
  lista, allowInvalid,
  getAllowInvalid: () => allowInvalid,
  getCriteriaType: () => "VALUE_IN_LIST",
  getCriteriaValues: () => [lista],
  copy: () => { let a = allowInvalid; const b = { setAllowInvalid: (x) => { a = x; return b; }, build: () => regla(lista, a) }; return b; },
});

class Hoja {
  constructor(nombre, filas, formulas = {}, reglas = {}) {
    this.nombre = nombre;
    this.v = filas.map((f) => [...f]);
    this.f = this.v.map((f, i) => f.map((_, j) => formulas[`${i + 1},${j + 1}`] || ""));
    this.notas = new Map();
    this.ancho = filas[0].length;
    this.reglas = reglas; // columna → regla (para todos los renglones de datos)
    this.propias = new Map(); // "r,c" → regla cambiada en esa celda
    this.fallarNotas = false;
  }
  regla(r, c) { return r < 2 ? null : this.propias.has(`${r},${c}`) ? this.propias.get(`${r},${c}`) : this.reglas[c] || null; }
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
  deleteRows(r, n) { for (let k = 0; k < n; k++) this.deleteRow(r); }
  getRange(r, c, nr = 1, nc = 1) {
    const h = this;
    const celdas = (fn) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(r + i, c + j)));
    const asegurar = (fila) => { while (h.v.length < fila) h.insertRowsAfter(0, 1); };
    const poner = (a, b, x) => {
      const rg = h.regla(a, b);
      if (rg && !rg.allowInvalid && x !== "" && !rg.lista.includes(x)) {
        throw new Error(`Los datos que ingresaste en la celda ${String.fromCharCode(64 + b)}${a} infringen las reglas de validación de datos establecidas. Ingresa uno de los siguientes valores: ${rg.lista.join(", ")}.`);
      }
      h.v[a - 1][b - 1] = x; h.f[a - 1][b - 1] = "";
    };
    return {
      getValues: () => celdas((a, b) => h.v[a - 1]?.[b - 1] ?? ""),
      getDisplayValues: () => celdas((a, b) => { const x = h.v[a - 1]?.[b - 1] ?? ""; return x instanceof Date ? x.toISOString().slice(0, 10) : String(x); }),
      getFormulas: () => celdas((a, b) => h.f[a - 1]?.[b - 1] ?? ""),
      getNotes: () => celdas((a, b) => h.notas.get(`${a},${b}`) || ""),
      getDataValidations: () => celdas((a, b) => h.regla(a, b)),
      setDataValidations: (m) => m.forEach((fila, i) => fila.forEach((x, j) => h.propias.set(`${r + i},${c + j}`, x))),
      setValues: (m) => { asegurar(r + nr - 1); m.forEach((fila, i) => fila.forEach((x, j) => poner(r + i, c + j, x))); },
      setValue: (x) => { h.v[r - 1][c - 1] = x; },
      setNote: (x) => { h.notas.set(`${r},${c}`, x); },
      setNotes: (m) => { if (h.fallarNotas) throw new Error("Falla de prueba"); m.forEach((fila, i) => h.notas.set(`${r + i},${c}`, fila[0])); },
      clearNote: () => { for (let i = 0; i < nr; i++) h.notas.delete(`${r + i},${c}`); },
      clearContent: () => celdas((a, b) => { h.v[a - 1][b - 1] = ""; h.f[a - 1][b - 1] = ""; }),
      // Solo lo que se pide: formato (nada acá), listas desplegables o fórmulas
      copyTo: (dest, tipo) => dest._pegar(r, c, nc, tipo),
      _pegar: (rf, cf, ncf, tipo) => {
        asegurar(r + nr - 1);
        for (let i = 0; i < nr; i++) {
          for (let j = 0; j < ncf; j++) {
            if (tipo === "PASTE_FORMULA") { const fo = h.f[rf - 1][cf + j - 1]; if (fo) { h.f[r + i - 1][c + j - 1] = fo; h.v[r + i - 1][c + j - 1] = ""; } }
            if (tipo === "PASTE_DATA_VALIDATION" && h.propias.has(`${rf},${cf + j}`)) h.propias.set(`${r + i},${c + j}`, h.propias.get(`${rf},${cf + j}`));
          }
        }
      },
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
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => hojas[n] || null }),
      flush: () => {},
      CopyPasteType: { PASTE_FORMAT: "PASTE_FORMAT", PASTE_DATA_VALIDATION: "PASTE_DATA_VALIDATION", PASTE_FORMULA: "PASTE_FORMULA" },
      DataValidationCriteria: { VALUE_IN_LIST: "VALUE_IN_LIST", VALUE_IN_RANGE: "VALUE_IN_RANGE" },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: (url, o) => { pedidos.push({ url, o }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(respuesta) }; } },
    ScriptApp: {},
  };
  const codigo = scriptLibro({ url: "https://gypi.test/api/finanzas/libro", clave: "gyp_clave" });
  const fn = new Function(...Object.keys(globales), `${codigo}\nreturn pasarLibroGypi;`);
  fn(...Object.values(globales))();
  return pedidos;
}

/** Lo que el script le contó a Gypi al terminar la vuelta. */
const estadoEnviado = (pedidos) => JSON.parse(pedidos.find((p) => p.o.method === "post").o.payload);

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

test("script — un dato fuera de la lista desplegable no frena el pase ni deja copias (12/11)", () => {
  const { ops, cheques } = libroDePrueba();
  // Como el libro real: la columna usuario (D) solo acepta "Tadeo"
  ops.reglas[4] = regla(["Tadeo"]);
  const op = { ...OP, id: 9, cargada_por_nombre: "Gypi (de Mantenimiento)", updated_at: "v9" };
  const respuesta = datosParaLibro({ operaciones: [OP, op], cheques: [], cuentas: CUENTAS });
  const antes = ops.getLastRow();
  const pedidos = correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta);
  const est = estadoEnviado(pedidos);
  assert.deepEqual(est.errores, []);
  assert.equal(est.avisos.length, 1);
  assert.match(est.avisos[0], /Gypi \(de Mantenimiento\)/);
  const marcas = ops.v.slice(1).map((f) => f[18]).filter(Boolean);
  assert.deepEqual(marcas, ["HORAS", "GY-F-5", "GY-F-9"], "entró una sola vez");
  assert.equal(ops.getLastRow(), antes, "uno borrado (GY-F-6) y uno nuevo");
  assert.equal(ops.v[3][3], "Gypi (de Mantenimiento)");
  assert.equal(ops.regla(4, 4).allowInvalid, true, "en ese renglón la lista pasa a advertencia");
  assert.equal(ops.regla(2, 4).allowInvalid, false, "los renglones a mano no se tocan");
  // Vueltas siguientes: nada se repite
  const foto = JSON.stringify(ops.v);
  correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta);
  correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta);
  assert.equal(JSON.stringify(ops.v), foto);
});

test("script — si algo falla al agregar, se deshace y el error llega a Gypi (sin renglones repetidos)", () => {
  const { ops, cheques } = libroDePrueba();
  ops.fallarNotas = true;
  const respuesta = datosParaLibro({ operaciones: [OP, { ...OP, id: 7, updated_at: "v7" }, { ...OP, id: 8, updated_at: "v8" }], cheques: [CHEQUE], cuentas: CUENTAS });
  for (let k = 0; k < 3; k++) {
    const est = estadoEnviado(correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta));
    assert.match(est.errores[0], /T-OPERACIONES: Falla de prueba/);
  }
  const conDatos = ops.v.slice(1).filter((f) => f[2] !== "" || f[18] !== "");
  assert.deepEqual(conDatos.map((f) => f[18]), ["HORAS", "GY-F-5"], "los renglones agregados quedaron vacíos, ni copias del de arriba");
  assert.equal(cheques.v[2][14], "GY-C-50", "R-CHEQUES pasa igual");
});

test("script — borra sus propias marcas repetidas y lista las copias a mano para confirmar", () => {
  const { ops, cheques } = libroDePrueba();
  const copia = fila(TITULOS_OPS, { C: 90, "fecha_operación": new Date(2026, 10, 12), usuario: "Tadeo", cod_tipo_op: "RESCATE PLAZO FIJO", importe_neto: 1798837.65, descripcion: "Vencimiento Plazo Fijo (Exento) Operacion: 17546006", estado: "CONFIRMADO" });
  ops.v.splice(4, 1, [...ops.v[2]], copia, { ...copia, 0: 91 }, { ...copia, 0: 92 });
  ops.v = ops.v.map((f) => (Array.isArray(f) ? f : TITULOS_OPS.map((_, i) => f[i])));
  ops.f = ops.v.map((f) => f.map(() => ""));
  const respuesta = datosParaLibro({ operaciones: [OP], cheques: [], cuentas: CUENTAS });
  const est = estadoEnviado(correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, respuesta));
  assert.deepEqual(ops.v.slice(1).map((f) => f[18]).filter((m) => m.startsWith("GY")), ["GY-F-5"], "el GY-F-5 repetido se borró");
  assert.equal(est.repetidos.length, 1);
  const [r] = est.repetidos;
  assert.equal(r.copias, 2);
  assert.match(r.descripcion, /17546006/);
  assert.equal(ops.v[r.fila - 1][0], 90, "el primero de los iguales");

  // El Dueño confirma: se borran las 2 copias y queda el primero
  const est2 = estadoEnviado(correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, { ...respuesta, borrar_repetidos: [{ fila: r.fila, copias: r.copias, firma: r.firma }] }));
  assert.equal(est2.borrados.length, 1);
  assert.equal(est2.repetidos.length, 0);
  assert.equal(ops.v.filter((f) => /17546006/.test(f[17])).length, 1);
  // Un pedido viejo que ya no coincide no borra nada
  const foto = JSON.stringify(ops.v);
  correrScript({ "T-OPERACIONES": ops, "R-CHEQUES": cheques }, { ...respuesta, borrar_repetidos: [{ fila: r.fila, copias: 2, firma: r.firma }] });
  assert.equal(JSON.stringify(ops.v), foto);
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
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: [] }) },
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
  assert.equal(d.cambios_cuentas, undefined, "un plan sin las cuentas repetidas de la propuesta no recibe cambios");

  const tok = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
  const post = async (rol) => api.POST(new Request("http://localhost/api/finanzas/libro", { method: "POST", headers: { Authorization: `Bearer ${await tok(rol)}` }, body: "{}" }));
  assert.equal((await post("administrativo")).status, 403);
  const ok = await post("gerencial");
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).script, /function instalarLibroGypi\(\)/);
});

test("/api/finanzas/libro — el script cuenta cómo salió y el Dueño confirma qué copias borrar", async () => {
  const { clave, hash } = generarClave(E);
  let valor = { hash };
  const parches = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (u) => u.includes(`/rest/v1/config_sistema`),
      respond: (u, o) => {
        if (o?.method === "PATCH") { valor = JSON.parse(o.body).valor; parches.push(valor); return { status: 200, body: [] }; }
        return { status: 200, body: [{ clave: CLAVE_LIBRO_FIN, valor }] };
      },
    },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
  ]);
  const rep = { fila: 8132, copias: 26, firma: "2026-11-12 | Tadeo | RESCATE", fecha: "12/11/2026", descripcion: "Vencimiento Plazo Fijo", total: "$1.798.837,65" };
  const estado = (k, cuerpo) => api.POST(new Request("http://localhost/api/finanzas/libro", { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }));
  assert.equal((await estado(generarClave(E).clave, { accion: "estado" })).status, 401, "otra clave no sirve");
  const r = await estado(clave, { accion: "estado", errores: ["T-OPERACIONES: Exception: Los datos que ingresaste en la celda D8281 infringen las reglas"], avisos: [], repetidos: [rep, { fila: 1, copias: 1, firma: "x" }], borrados: [] });
  assert.equal(r.status, 200);
  assert.equal(valor.hash, hash, "la clave sigue");
  assert.equal(valor.estado.repetidos.length, 1, "el renglón de títulos no cuenta");
  assert.match(valor.estado.errores[0], /D8281/);

  const tok = (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" })).token;
  const pedir = (repetidos) => api.POST(new Request("http://localhost/api/finanzas/libro", { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ accion: "borrar_repetidos", repetidos }) }));
  assert.equal((await pedir([{ fila: 5, firma: "inventado" }])).status, 400, "solo lo que mostró el script");
  const ok = await pedir([{ fila: 8132, firma: rep.firma }]);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).copias, 26);
  assert.deepEqual(valor.borrar, [{ fila: 8132, copias: 26, firma: rep.firma }]);

  // El script los borró: deja de estar pedido
  await estado(clave, { accion: "estado", errores: [], avisos: [], repetidos: [], borrados: [rep] });
  assert.deepEqual(valor.borrar, []);
  assert.equal(valor.estado.borrados.length, 1);
});
