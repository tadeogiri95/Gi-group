// tests/finanzas-libro-cuentas.test.jsx — Los 6 cambios de cuentas al libro
// (parte 7 del plan del 11/11, aprobados por Tadeo con su copia hecha).
// El script se prueba contra un libro de mentira con la forma del real.
import "./helpers/domSetup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosCuentasLibro, planConRepetidos, VERSION_CAMBIOS_CUENTAS, RECODIFICAR } from "../app/lib/finanzasLibroCuentas.js";
import { datosParaLibro, scriptLibro } from "../app/lib/finanzasLibro.js";

const PLAN = [
  ["01.01.01.003.003", "BANCO ICBC CTA CTE"],
  ["01.01.01.003.003", "BANCO ICBC CTA CTE - Cheques Diferidos"],
  ["01.01.01.003.003", "BANCO ICBC CTA CTE - E-Cheq"],
  ["01.01.03.111.001", "Cuenta Particular Titular O Socio"],
  ["01.02.02.001.020", "Equipos - Amort.Acum."],
  ["01.02.02.001.020", "Equipos - Valor Costo"],
  ["01.02.02.001.020", "Terrenos - Valor Costo"],
  ["01.02.02.001.020", "Terrenos - Amort.Acum."],
  ["01.02.02.001.020", "Herramientas - Amort.Acum."],
  ["01.02.02.001.020", "Herramientas - Valor Costo"],
  ["02.01.02.003.001", "Acreedores Varios"],
  ["02.01.03.001.001", "Sueldos A Pagar"],
  ["02.01.03.002.001", "Cargas Sociales A Pagar"],
  ["02.01.03.002.100", "Cargas Sociales A Pagar"],
  ["03.01.01.002.001", "Ajuste De Capital"],
  ["04.02.01.001.019", "Gastos General"],
  ["04.02.01.001.062", "Viáticos"],
];
const cuentas = PLAN.map(([codigo, nombre]) => ({ codigo, nombre }));

test("cambiosCuentasLibro — solo para el plan de la propuesta; tipos por nombre, con las cuentas nuevas", () => {
  assert.equal(cambiosCuentasLibro({ cuentas: [{ codigo: "1", nombre: "Caja" }] }), null, "otra empresa u otro plan: nada");
  assert.equal(planConRepetidos(cuentas), true);
  const sinRepetidos = cuentas.filter((c) => !RECODIFICAR.some((x) => x.nombre === c.nombre) && c.codigo !== "02.01.03.002.100");
  assert.equal(cambiosCuentasLibro({ cuentas: sinRepetidos }), null, "el libro ya arreglado y copiado a Gypi: no se manda más");

  const c = cambiosCuentasLibro({
    cuentas,
    tipos: [
      { codigo: "PROV SAC", cuenta_debe: "04.02.01.001.019", cuenta_haber: "02.01.03.002.001" },
      { codigo: "Ajuste de caja negativo", cuenta_debe: "03.01.01.002.001", cuenta_haber: "01.01.01.003.003" },
    ],
  });
  assert.equal(c.version, VERSION_CAMBIOS_CUENTAS);
  assert.equal(c.recodificar.length, 9);
  const t = new Map(c.tipos.map((x) => [x.codigo.toUpperCase(), x]));
  assert.deepEqual([t.get("PROV SAC").debe, t.get("PROV SAC").haber], [null, "Provisión SAC A Pagar"], "la cuenta nueva cuenta aunque todavía no esté");
  assert.equal(t.get("AJUSTE DE CAJA NEGATIVO").debe, "Faltantes y Sobrantes de Caja");
  assert.equal(t.get("PAGO TRIANGULAR").haber, "Cuenta Particular Titular O Socio", "los arreglos fijos van aunque Gypi no tenga el tipo");
  assert.equal(c.tipos.filter((x) => x.codigo.toUpperCase() === "PROV SAC").length, 1, "un tipo una sola vez");
  assert.equal(c.ajuste.nombre, "Ajuste De Capital");
  assert.match("APERTURA 2025", new RegExp(c.ajuste.permitidos));
  assert.doesNotMatch(c.ajuste.permitidos, /["\\]/, "va adentro de una fórmula de Sheets");

  const d = datosParaLibro({ cuentas, cambiosCuentas: c });
  assert.equal(d.cambios_cuentas, c);
  assert.equal("cambios_cuentas" in datosParaLibro({ cuentas }), false);
});

// ─── El script, contra un libro de mentira ───

class Hoja {
  constructor(nombre, filas = [], formulas = {}) {
    this.nombre = nombre;
    this.v = filas.map((f) => [...f]);
    this.f = this.v.map((f, i) => f.map((_, j) => formulas[`${i + 1},${j + 1}`] || ""));
  }
  ancho() { return Math.max(0, ...this.v.map((f) => f.length)); }
  getLastColumn() { return this.ancho(); }
  getLastRow() {
    for (let i = this.v.length - 1; i >= 0; i--) if (this.v[i].some((x) => x !== "") || this.f[i].some(Boolean)) return i + 1;
    return 0;
  }
  setName(n) { this.nombre = n; return this; }
  copyTo(libro) { const h = new Hoja(this.nombre, this.v); h.f = this.f.map((f) => [...f]); libro.hojas.push(h); return h; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.v.length), Math.max(1, this.ancho())); }
  clearContents() { this.v = []; this.f = []; }
  deleteRow(r) { this.v.splice(r - 1, 1); this.f.splice(r - 1, 1); }
  insertRowAfter(r) { const n = this.ancho(); this.v.splice(r, 0, Array(n).fill("")); this.f.splice(r, 0, Array(n).fill("")); }
  getRange(r, c, nr = 1, nc = 1) {
    const h = this;
    const celdas = (fn) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(r + i, c + j)));
    const poner = (a, b, x, f = "") => {
      while (h.v.length < a) { h.v.push(Array(h.ancho()).fill("")); h.f.push(Array(h.ancho()).fill("")); }
      h.v[a - 1][b - 1] = x; h.f[a - 1][b - 1] = f;
    };
    return {
      getValues: () => celdas((a, b) => h.v[a - 1]?.[b - 1] ?? ""),
      getDisplayValues: () => celdas((a, b) => String(h.v[a - 1]?.[b - 1] ?? "")),
      getFormulas: () => celdas((a, b) => h.f[a - 1]?.[b - 1] ?? ""),
      getDisplayValue: () => String(h.v[r - 1]?.[c - 1] ?? ""),
      setValue: (x) => poner(r, c, x),
      setFormula: (x) => poner(r, c, "", x),
      setValues: (m) => m.forEach((fila, i) => fila.forEach((x, j) => poner(r + i, c + j, x))),
      copyTo: (_dest, o) => { if (o?.contentsOnly) h.f = h.f.map((f) => f.map(() => "")); },
    };
  }
}

const TIT_OPS = ["C", "fecha_operación", "cod_tipo_op", "cuenta_debe_override", "cuenta_haber_override", "estado", "cuenta_debe_final", "cuenta_haber_final"];
const TIT_PLAN = ["codigo", "nombre", "tipo", "rubro", "clasificacion_eerr", "nota_mapeo"];
const TIT_TIPOS = ["cod_tipo_op", "nombre", "grupo", "base_contable", "subcuenta_debe_default", "nombre_debe", "subcuenta_haber_default", "nombre_haber"];

function libroDePrueba() {
  const libro = {
    hojas: [
      new Hoja("dim_plan_cuentas", [TIT_PLAN, ...PLAN.map(([c, n]) => [c, n, "", c.startsWith("04") ? "RESULTADO" : "", n === "Gastos General" ? "GO_SER_GEN" : "", ""])]),
      new Hoja("dim_tipos_op", [
        TIT_TIPOS,
        ["PROV SAC", "Provisión SAC", "SUELDOS", "DEVENGADO", "04.02.01.001.019", "Gastos General", "02.01.03.002.001", "Cargas Sociales A Pagar"],
        ["PAGO TRIANGULAR", "Pago triangular", "SOCIOS", "PERCIBIDO", "02.01.02.003.001", "Acreedores Varios", "03.01.01.002.001", "Ajuste De Capital"],
        ["AJUSTE DE CAJA NEGATIVO", "Ajuste de caja", "CAJA", "PERCIBIDO", "", "", "01.01.01.003.003", "BANCO ICBC CTA CTE"],
      ]),
      new Hoja("T-OPERACIONES", [
        TIT_OPS,
        [1, "2026-10-01", "PROV SAC", "", "", "CONFIRMADO", "04.02.01.001.019", "02.01.03.002.001"],
        [2, "2026-10-02", "PROV SAC", "", "Acreedores Varios", "CONFIRMADO", "04.02.01.001.019", "02.01.02.003.001"],
        [3, "2026-10-03", "COMPRA", "Herramientas - Valor Costo", "Acreedores Varios", "CONFIRMADO", "01.02.02.001.020", "02.01.02.003.001"],
        [4, "2026-10-04", "COMPRA", "Terrenos - Valor Costo", "Acreedores Varios", "CONFIRMADO", "01.02.02.001.020", "02.01.02.003.001"],
        [5, "2026-10-05", "OTRO", "Cargas Sociales A Pagar", "Acreedores Varios", "CONFIRMADO", "02.01.03.002.001", "02.01.02.003.001"],
      ]),
      new Hoja("CHK_CARGA", [
        ["", "CONTROL DE CARGA", "", ""],
        ["", "Desde (fecha):", "2026-10-12", ""],
        ["", "", "", ""],
        ["", "Alerta", "Cantidad", "Qué significa"],
        ["", "[CUENTA ERROR]", "", "da error"],
        ["", "Total filas con alerta", "", ""],
        ["", "Importe SIN CLASIFICAR (ARS)", "", ""],
      ], { "5,3": "=COUNTIFS(Z:Z,\"*\")", "6,3": "=COUNTIFS(Z:Z,\"?*\")" }),
    ],
    getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; },
    insertSheet(n) { const h = new Hoja(n); this.hojas.push(h); return h; },
    toast(m) { this.aviso = m; },
    getSpreadsheetTimeZone: () => "America/Argentina/Cordoba",
  };
  return libro;
}

function correr(libro, cambios, props = {}) {
  const globales = {
    PropertiesService: { getDocumentProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { formatDate: () => "20261111_1200" },
  };
  const codigo = scriptLibro({ url: "https://gypi.test/api/finanzas/libro", clave: "gyp_clave" });
  const fn = new Function(...Object.keys(globales), `${codigo}\nreturn gypiLibroCuentas_;`)(...Object.values(globales));
  fn(libro, JSON.parse(JSON.stringify(cambios)));
  return props;
}

const PLAN_TIPOS = [
  { codigo: "PROV SAC", cuenta_debe: "04.02.01.001.019", cuenta_haber: "02.01.03.002.001" },
  { codigo: "AJUSTE DE CAJA NEGATIVO", cuenta_debe: null, cuenta_haber: "01.01.01.003.003" },
];

test("script — copia de respaldo, una sola vez, y los 6 cambios con sus controles", () => {
  const libro = libroDePrueba();
  const cambios = cambiosCuentasLibro({ cuentas, tipos: PLAN_TIPOS });
  const props = correr(libro, cambios);
  assert.equal(props.gypi_cuentas_version, String(VERSION_CAMBIOS_CUENTAS));
  for (const n of ["dim_plan_cuentas", "dim_tipos_op", "T-OPERACIONES", "CHK_CARGA"]) assert.ok(libro.getSheetByName(`${n}_bk_cuentas_20261111_1200`), `copia de ${n}`);
  assert.equal(libro.getSheetByName("dim_plan_cuentas_bk_cuentas_20261111_1200").v[2][0], "01.01.01.003.003", "la copia queda como estaba");

  const plan = libro.getSheetByName("dim_plan_cuentas").v.slice(1);
  const codigo = (n) => plan.filter((f) => f[1] === n).map((f) => f[0]);
  // 1. Códigos propios
  assert.deepEqual(codigo("BANCO ICBC CTA CTE"), ["01.01.01.003.003"]);
  assert.deepEqual(codigo("BANCO ICBC CTA CTE - Cheques Diferidos"), ["01.01.01.004.004"]);
  assert.deepEqual(codigo("Herramientas - Valor Costo"), ["01.02.02.001.023"]);
  // 2. Terrenos: el que usa una operación queda; el otro se saca
  assert.deepEqual(codigo("Terrenos - Valor Costo"), ["01.02.02.001.020"]);
  assert.deepEqual(codigo("Terrenos - Amort.Acum."), []);
  // 3. Nombre repetido: cambia el que no toman las operaciones (el segundo)
  assert.deepEqual(codigo("Cargas Sociales A Pagar"), ["02.01.03.002.001"]);
  assert.deepEqual(codigo("Cargas Sociales A Pagar - Detalle"), ["02.01.03.002.100"]);
  // 4. Cuentas nuevas abajo de su vecina, con la clasificación de una parecida
  const i = plan.findIndex((f) => f[1] === "Sueldos A Pagar");
  assert.deepEqual(plan.slice(i + 1, i + 3).map((f) => f[0]), ["02.01.03.001.002", "02.01.03.001.003"]);
  const faltantes = plan.find((f) => f[1] === "Faltantes y Sobrantes de Caja");
  assert.deepEqual(faltantes, ["04.02.01.001.064", "Faltantes y Sobrantes de Caja", "", "RESULTADO", "GO_SER_GEN", "Agregada por Gypi"]);
  assert.equal(plan[plan.indexOf(faltantes) - 1][1], "Viáticos");

  // 5. Tipos: código y nombre nuevos; los renglones viejos sin cuenta escrita quedan con la suya
  const tipos = libro.getSheetByName("dim_tipos_op").v;
  assert.deepEqual(tipos[1].slice(4), ["04.02.01.001.019", "Gastos General", "02.01.03.001.002", "Provisión SAC A Pagar"]);
  assert.deepEqual(tipos[2].slice(6), ["01.01.03.111.001", "Cuenta Particular Titular O Socio"]);
  assert.deepEqual(tipos[3].slice(4, 6), ["04.02.01.001.064", "Faltantes y Sobrantes de Caja"]);
  const ops = libro.getSheetByName("T-OPERACIONES").v;
  assert.equal(ops[1][4], "Cargas Sociales A Pagar", "la provisión vieja sigue en la cuenta que tenía");
  assert.equal(ops[1][3], "", "el lado que no cambia no se toca");
  assert.equal(ops[2][4], "Acreedores Varios", "lo escrito a mano no se toca");

  // 6. CHK_CARGA: abajo del total, con la cuenta y los tipos permitidos
  const chk = libro.getSheetByName("CHK_CARGA");
  assert.equal(chk.v[6][1], "[AJUSTE DE CAPITAL]");
  assert.equal(chk.v[7][1], "Importe SIN CLASIFICAR (ARS)");
  const f = chk.f[6][2];
  assert.match(f, /^=ARRAYFORMULA\(SUMPRODUCT\(/);
  assert.match(f, /'T-OPERACIONES'!\$B\$2:\$B>=\$C\$2/, "fecha_operación por título");
  assert.match(f, /'T-OPERACIONES'!\$G\$2:\$G&"",""\)="03\.01\.01\.002\.001"/);
  assert.match(f, /REGEXMATCH\(UPPER\('T-OPERACIONES'!\$C\$2:\$C&""\),"APERTURA\|SALDO INICIAL/);
  assert.equal((f.match(/\(/g) || []).length, (f.match(/\)/g) || []).length, "paréntesis parejos");

  // Lo que hizo, a la vista
  const log = libro.getSheetByName("gypi_cambios_cuentas").v;
  assert.deepEqual(log[0], ["Cambio", "Cuenta o tipo", "Qué pasó"]);
  assert.ok(log.some((x) => x[1] === "Terrenos - Valor Costo" && /La usan 1 operaciones/.test(x[2])));
  assert.ok(log.some((x) => /no está con el código/i.test(x[2])), "lo que no está en este libro se anota y no se toca");
  assert.match(libro.aviso, /_bk_cuentas_20261111_1200/);

  // Otra pasada (cada 15 minutos): nada
  const antes = JSON.stringify(libro.hojas.map((h) => [h.nombre, h.v]));
  correr(libro, cambios, props);
  assert.equal(JSON.stringify(libro.hojas.map((h) => [h.nombre, h.v])), antes);
});

test("script — no pisa: código ocupado, cuenta distinta o tipo que falta", () => {
  const libro = libroDePrueba();
  const pc = libro.getSheetByName("dim_plan_cuentas");
  pc.getRange(pc.getLastRow() + 1, 1, 2, 2).setValues([["01.01.01.005.004", "Otra cuenta"], ["02.01.03.001.002", "Ya usado"]]);
  libro.hojas = libro.hojas.filter((h) => h.nombre !== "CHK_CARGA");
  correr(libro, cambiosCuentasLibro({ cuentas, tipos: PLAN_TIPOS }));
  const plan = pc.v.slice(1);
  assert.deepEqual(plan.filter((f) => f[1] === "BANCO ICBC CTA CTE - E-Cheq").map((f) => f[0]), ["01.01.01.003.003"], "el código nuevo ya era de otra: queda");
  assert.equal(plan.filter((f) => f[1] === "Provisión SAC A Pagar").length, 0);
  const log = libro.getSheetByName("gypi_cambios_cuentas").v;
  assert.ok(log.some((x) => x[1] === "Provisión SAC A Pagar" && /ya es de otra cuenta/.test(x[2])));
  assert.ok(log.some((x) => x[1] === "PROV SAC (haber)" && /No encontré una sola cuenta/.test(x[2])), "sin la cuenta nueva el tipo no cambia");
  assert.equal(libro.getSheetByName("dim_tipos_op").v[1][6], "02.01.03.002.001");
  assert.ok(log.some((x) => x[1] === "PAGO IMPUESTO" && /no está en dim_tipos_op/.test(x[2])));
  assert.ok(log.some((x) => x[0] === "6. CHK_CARGA" && /No está la hoja/.test(x[2])));
});

test("script — con una versión ya aplicada no hace nada (ni copia)", () => {
  const libro = libroDePrueba();
  correr(libro, cambiosCuentasLibro({ cuentas, tipos: PLAN_TIPOS }), { gypi_cuentas_version: String(VERSION_CAMBIOS_CUENTAS) });
  assert.equal(libro.hojas.length, 4);
});
