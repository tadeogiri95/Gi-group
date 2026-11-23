// tests/finanzas-informes-sueltos.test.jsx — 19/11 (pedido de Tadeo): cada
// informe se baja por separado, en PDF o Excel: Estado de Resultados, Flujo
// de caja, Flujo de cheques, Cuentas a cobrar y a pagar, Situación patrimonial.
import "./helpers/domSetup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { informeCheques, informeFlujo, informePatrimonio, informeResultados } from "../app/lib/finanzasInformesSueltos.js";
import { hojaInforme, nombreArchivo } from "../app/lib/finanzasInformes.js";
import { armarXlsx } from "../app/lib/xlsxSimple.js";

const leer = (f) => readFileSync(new URL(`../app/components/${f}`, import.meta.url), "utf8");

test("la hoja de un informe suelto: título, empresa y sin pasarse del ancho", () => {
  const h = hojaInforme({ titulo: "Flujo <x>", empresa: "Gi Group", subtitulo: "Oct", cuerpo: "<p>hola</p>" });
  assert.match(h, /<h1>Flujo &lt;x&gt;<\/h1>/);
  assert.match(h, /Gi Group · Oct/);
  assert.match(h, /margin:0;padding:24px/, "el margen va adentro del ancho de la hoja del PDF");
  assert.equal(nombreArchivo('Cuentas a pagar al 19/11/2026'), "Cuentas a pagar al 19-11-2026");
});

test("Estado de Resultados: por mes, con secciones, % y total; el Excel abre", () => {
  const inf = informeResultados({
    meses: ["2026-10", "2026-11"],
    filas: [
      { tipo: "seccion", id: "ING", nombre: "Ingresos", valores: [100, 200], total: 300 },
      { tipo: "linea", id: "x", nombre: "OT 7001", valores: [100, 0], total: 100, entrega_estimada: true },
      { tipo: "resultado", id: "RDO_NETO", nombre: "Resultado", valores: [-50, 80], total: 30 },
      { tipo: "pct", id: "RDO_PCT", nombre: "% s/ingresos", valores: [-50, 40], total: 10 },
    ],
  });
  assert.match(inf.titulo, /^Estado de Resultados - /);
  const html = inf.html();
  assert.match(html, /OT 7001 \(estimado\)/);
  assert.match(html, /class="n rojo">-50</);
  assert.match(html, /40 %/);
  const [hoja] = inf.hojas();
  assert.deepEqual(hoja.filas[3].length, 4, "concepto, 2 meses y total");
  assert.equal(hoja.filas[4][3].v, 300);
  assert.ok(armarXlsx(inf.hojas()).length > 500);
});

test("Flujo de caja: saldo al empezar, líneas, neto y saldo al cerrar", () => {
  const inf = informeFlujo({
    meses: ["2026-10", "2026-11"],
    monedas: { ARS: { apertura: 1000, cierre: [1500, 1200], neto: [500, -300], filas: [{ tipo: "seccion", id: "OPE", nombre: "Operativo", valores: [500, -300], total: 200 }], hay: true } },
  }, "ARS");
  const [hoja] = inf.hojas();
  const nombres = hoja.filas.slice(4).map((f) => (typeof f[0] === "string" ? f[0].trim() : f[0].v));
  assert.deepEqual(nombres, ["Saldo al empezar el mes", "Operativo", "Flujo neto del mes", "Saldo al cerrar el mes"]);
  assert.deepEqual(hoja.filas[4].slice(1, 3).map((c) => c.v), [1000, 1500]);
  assert.equal(hoja.filas[6][3].v, 200);
  assert.equal(informeFlujo({ meses: [], monedas: {} }, "USD"), null);
});

test("Situación patrimonial: activo, pasivo y patrimonio con sus rubros", () => {
  const s = (id, nombre, total, rubros = []) => ({ id, nombre, total, rubros });
  const inf = informePatrimonio({
    secciones: [s("AC", "Activo corriente", 800, [{ codigo: "1", nombre: "Caja", saldo: 800 }]), s("ANC", "Activo no corriente", 200), s("PC", "Pasivo corriente", 300), s("PNC", "Pasivo no corriente", 0), s("PN", "Patrimonio neto", 700)],
    activo: 1000, pasivo: 300, patrimonio: 700, cuadra: true,
  }, "2026-11-19");
  assert.equal(inf.titulo, "Situación patrimonial al 19/11/2026");
  assert.match(inf.html(), /Total del activo<\/td><td class="n">\$\s?1\.000,00/);
  const filas = inf.hojas()[0].filas;
  assert.ok(filas.some((f) => f[0] === "    Caja" && f[1].v === 800));
  assert.equal(informePatrimonio(null, "2026-11-19"), null);
});

test("Flujo de cheques: por semana y cada cheque vivo", () => {
  const inf = informeCheques({
    hoy: "2026-11-19",
    calendario: [{ etiqueta: "Vencidos", cantidad: 0, debitar: 0, cobrar: 0 }, { etiqueta: "1 a 7 días", cantidad: 2, debitar: 300, cobrar: 500 }],
    cheques: [
      { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-22", importe: 300, banco: "Credicoop", numero: "9", beneficiario: "Egger" },
      { clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-24", importe: 500, librador: "Gómez" },
      { clase: "tercero", estado: "depositado", fecha_pago: "2026-11-01", importe: 999 },
    ],
  });
  const [semana, cada] = inf.hojas();
  assert.equal(semana.filas.length, 6, "título, vacías, encabezado, una semana con cheques y total");
  assert.equal(semana.filas[4][4].v, 200);
  assert.equal(cada.filas.length, 3, "encabezado y los 2 vivos (el depositado no)");
  assert.match(inf.html(), /Credicoop N° 9/);
});

test("cada pantalla tiene su 📄 PDF y 📊 Excel", () => {
  assert.match(leer("FinanzasResultados.jsx"), /<BotonesExportar nombre="el Estado de Resultados" informe=\{\(\) => informeResultados\(datos\)\} \/>/);
  assert.match(leer("FinanzasFlujo.jsx"), /informeFlujo\(datos, moneda\)/);
  assert.match(leer("FinanzasPatrimonio.jsx"), /informePatrimonio\(datos\?\.situacion/);
  assert.match(leer("FinanzasCheques.jsx"), /informeCheques\(\{ calendario, cheques, hoy, quien \}\)/);
  assert.match(leer("FinanzasCuentasPagarCobrar.jsx"), /informeCuentas\(r, ladoId\)/);
});
