// tests/finanzas-informe-tesoreria.test.jsx — 19/11 (pedido de Tadeo): Informe
// de tesorería con fondos en pesos y dólares, inversiones, calce de cheques a
// pagar contra plazos fijos (8 semanas y 15 días) y cheques a cobrar.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compacto, panoramaTexto, MAX_COBROS, informeTesoreria, exportarInformeTesoreria, periodosDias, periodosSemanas, repartoFondos, serieCobrar, serieCalce, geometriaColumnas } from "../app/lib/finanzasInformeTesoreria.js";
import { armarXlsx } from "../app/lib/xlsxSimple.js";
import { opcionesBoton } from "../app/lib/menuGestion.js";
import { GRUPOS_FINANZAS, DETALLE_FINANZAS } from "../app/lib/finanzasInicio.js";
const { default: Pantalla } = await import("../app/components/FinanzasInformeTesoreria.jsx");

afterEach(() => cleanup());

const HOY = "2026-11-19"; // jueves
const tesoreria = [
  { cuenta: "1.1", nombre: "Caja oficina", tipo: "caja", moneda: "ARS" },
  { cuenta: "1.2", nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS" },
  { cuenta: "1.3", nombre: "Caja dólares", tipo: "caja", moneda: "USD" },
  { cuenta: "1.4", nombre: "FCI Credicoop", tipo: "fci", moneda: "ARS" },
  { cuenta: "1.5", nombre: "Plazo fijo", tipo: "plazo_fijo", moneda: "ARS" },
];
const operaciones = [
  { fecha: "2026-11-01", cuenta_debe: "1.1", cuenta_haber: "9", total: 1000, total_ars: 1000 },
  { fecha: "2026-11-02", cuenta_debe: "1.2", cuenta_haber: "9", total: 50000, total_ars: 50000 },
  { fecha: "2026-11-03", cuenta_debe: "9", cuenta_haber: "1.2", total: 2000, total_ars: 2000 },
  { fecha: "2026-11-04", cuenta_debe: "1.3", cuenta_haber: "9", total: 300, total_ars: 450000, moneda: "USD" },
  { fecha: "2026-11-05", cuenta_debe: "1.1", cuenta_haber: "9", total: 5, total_ars: 5, anulada_at: "2026-11-06" },
  { fecha: "2026-12-01", cuenta_debe: "1.1", cuenta_haber: "9", total: 77, total_ars: 77 },
];
const inversiones = {
  fci: [{ cuenta: "1.4", nombre: "FCI Credicoop", moneda: "ARS", saldo: 20000 }],
  titulos: { valor: 15000, tipo_cambio: 1500, falta_tc: false, especies: [{ id: "AL30", especie: "AL30", laminas: 1000, cotizacion: 1500, moneda: "ARS", valor: 15000 }] },
};
const plazos = [
  { certificado: "111", moneda: "ARS", depositado: 10000, reembolsar: 10300, interes: 300, vencimiento: "2026-11-23", situacion: "vigente" },
  { certificado: "222", moneda: "ARS", depositado: 5000, reembolsar: 5100, interes: 100, vencimiento: "2026-12-10", situacion: "vigente" },
  { certificado: "333", moneda: "ARS", depositado: 9000, reembolsar: 9100, interes: 100, vencimiento: "2026-11-01", situacion: "terminado" },
];
const cheques = [
  // vence vie 20/11 → se debita el lunes 23/11
  { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-20", importe: 8000, banco: "Credicoop", numero: "1", beneficiario: "Maderera" },
  { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-25", importe: 4000, beneficiario: "Herrajes" },
  { clase: "propio", estado: "pendiente", fecha_pago: "2026-11-10", importe: 500, beneficiario: "Vencido" },
  { clase: "propio", estado: "debitado", fecha_pago: "2026-11-18", importe: 99999 },
  { clase: "tercero", estado: "en_cartera", fecha_pago: "2026-11-24", importe: 7000, librador: "Cliente SA" },
  { clase: "tercero", estado: "depositado", fecha_pago: "2026-11-24", importe: 1 },
];

const r = informeTesoreria({ hoy: HOY, tesoreria, operaciones, inversiones, plazos, cheques });

test("cajas y bancos: saldo de hoy por moneda, sin anuladas ni lo de después; FCI y PF van en inversiones", () => {
  assert.deepEqual(r.fondos.ARS.cajas.map((c) => [c.nombre, c.saldo]), [["Caja oficina", 1000], ["Banco Credicoop", 48000]]);
  assert.equal(r.fondos.ARS.total, 49000);
  assert.equal(r.fondos.USD.total, 300);
  assert.equal(r.resumen.dolares, 300);
});

test("inversiones: FCI, títulos y plazos fijos vigentes (los terminados no)", () => {
  assert.equal(r.fci[0].saldo, 20000);
  assert.equal(r.titulos.valor, 15000);
  assert.deepEqual(r.plazos.map((p) => p.certificado), ["111", "222"]);
  assert.equal(r.invertido.ARS, 20000 + 15000 + 15000);
});

test("calce: 8 semanas y 15 días, cheques al día del débito contra plazos fijos, con acumulado", () => {
  assert.equal(periodosSemanas(HOY).length, 8);
  assert.equal(periodosDias(HOY).length, 15);
  const s = r.calce.semanal;
  assert.equal(s[0].id, "vencidos");
  assert.equal(s[0].cheques, 500);
  assert.equal(s[0].acumulado, -500);
  // semana 1 (19/11 a 25/11): cheque 8000 (débito 23/11) + PF 111 que vence el 23/11; el de 4000 se debita el 26/11
  assert.equal(s[1].cheques, 8000);
  assert.equal(s[1].plazos, 10300);
  assert.equal(s[1].diferencia, 2300);
  assert.equal(s[1].acumulado, 1800);
  assert.equal(s[2].cheques, 4000);
  assert.equal(s.length, 1 + 8 + 1);
  const lunes = r.calce.diario.find((d) => d.desde === "2026-11-23");
  assert.equal(lunes.cheques, 8000);
  assert.equal(lunes.plazos, 10300);
  assert.equal(r.calce.diario.at(-1).desde, "2026-12-03");
  assert.ok(r.calce.faltante, "arranca en rojo por el vencido");
});

test("cheques a cobrar: solo los de terceros en cartera, por semana de acreditación", () => {
  assert.equal(r.resumen.cheques_cobrar, 7000);
  assert.equal(r.cobrar.length, 1);
  assert.equal(r.cobrar[0].items[0].quien, "Cliente SA");
  assert.equal(r.cobrar[0].items[0].fecha, "2026-11-25");
});

test("PDF y Excel: las 4 secciones y el Excel abre", () => {
  const inf = exportarInformeTesoreria(r, { empresa: "Gi Group" });
  assert.equal(inf.titulo, "Reporte de Tesorería al 19/11/2026");
  const h = inf.html();
  for (const t of ["Panorama de hoy", "1. Posición de fondos e inversiones", "2. Calce de cheques a pagar y plazos fijos", "Por día · próximos 15 días", "3. Cheques a cobrar"]) assert.ok(h.includes(t), t);
  assert.equal((h.match(/class="pagina"/g) || []).length, 4, "4 páginas fijas (20/11)");
  assert.equal(inf.bloques, ".pagina", "el PDF corta entre páginas, nunca adentro de una tabla");
  assert.ok(!h.includes("Maderera"), "sin el detalle de cada cheque del calce: conciso (19/11)");
  const hojas = inf.hojas();
  assert.deepEqual(hojas.map((x) => x.nombre), ["Fondos e inversiones", "Calce", "Cheques a cobrar"]);
  assert.ok(armarXlsx(hojas).length > 100);
});

test("menú: Informe de tesorería en Informes, después del Reporte financiero", () => {
  const ids = opcionesBoton("finanzas", { modulos: ["proyectos", "finanzas"] }, { rol: "gerencial" }).map((o) => o.id);
  assert.equal(ids[ids.indexOf("fin-reporte") + 1], "fin-informe-tesoreria");
  assert.ok(GRUPOS_FINANZAS.find((g) => g.id === "informes").opciones.includes("fin-informe-tesoreria"));
  assert.ok(DETALLE_FINANZAS["fin-informe-tesoreria"]);
  const pantalla = readFileSync(new URL("../app/components/screens/BotonGestionScreen.jsx", import.meta.url), "utf8");
  assert.match(pantalla, /fin-informe-tesoreria" && <FinanzasInformeTesoreria/);
});

test("pantalla: las 4 secciones, semana o día, y los botones para bajarlo", async () => {
  global.fetch = async (u) => {
    const url = String(u);
    const json = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes("/tesoreria")) return json({ tesoreria, operaciones });
    if (url.includes("/inversiones")) return json({ ...inversiones, hoy: HOY });
    if (url.includes("/plazos-fijos")) return json({ hoy: HOY, plazos });
    return json({ cheques, proveedores: [], feriados: [] });
  };
  render(<Pantalla />);
  const fondos = await screen.findByRole("region", { name: "1. Cajas y bancos" });
  assert.ok(within(fondos).getByText(/Banco Credicoop/));
  assert.ok(screen.getByRole("region", { name: "2. Inversiones" }));
  const calce = screen.getByRole("region", { name: "3. Calce de cheques a pagar y plazos fijos" });
  assert.ok(within(calce).getByText(/Semana 1/));
  fireEvent.click(within(calce).getByRole("button", { name: /Por día/ }));
  assert.ok(within(calce).getByText(/lun 23\/11/));
  fireEvent.click(within(calce).getByRole("button", { name: /lun 23\/11/ }));
  assert.ok(within(calce).getByText(/Maderera/));
  assert.ok(within(screen.getByRole("region", { name: "4. Cheques a cobrar" })).getByText(/Cliente SA/));
  assert.ok(screen.getByRole("button", { name: "📄 PDF" }));
});

test("gráficos: dónde está la plata, calce con acumulado y cobros por semana (pantalla y PDF)", async () => {
  const rep = repartoFondos(r);
  assert.deepEqual(rep.partes.map((p) => [p.nombre, p.valor]), [["Cajas", 1000], ["Bancos", 48000], ["FCI", 20000], ["Títulos", 15000], ["Plazos fijos", 15000]]);
  assert.equal(rep.total, 99000);
  assert.ok(Math.abs(rep.partes.reduce((s, p) => s + p.pct, 0) - 100) < 0.3);
  const cob = serieCobrar(r);
  assert.equal(cob.length, 8, "las 8 semanas, aunque estén vacías");
  assert.equal(cob.find((t) => t.total).total, 7000);
  const g = geometriaColumnas(serieCalce(r.calce.semanal), { linea: true });
  assert.equal(g.cols.length, r.calce.semanal.length);
  assert.ok(g.cols[0].linea > g.cero, "el acumulado de los vencidos queda debajo de la raya");
  const h = exportarInformeTesoreria(r).html();
  for (const t of ["Dónde está la plata", "Calce por semana", "Calce por día", "Cheques a cobrar por semana"]) assert.ok(h.includes(t), t);

  global.fetch = async (u) => {
    const url = String(u);
    const json = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.includes("/tesoreria")) return json({ tesoreria, operaciones });
    if (url.includes("/inversiones")) return json({ ...inversiones, hoy: HOY });
    if (url.includes("/plazos-fijos")) return json({ hoy: HOY, plazos });
    return json({ cheques, proveedores: [], feriados: [] });
  };
  render(<Pantalla />);
  assert.ok(await screen.findByRole("img", { name: /Bancos 48,5 %/ }));
  assert.ok(screen.getByRole("img", { name: "Calce por semana" }));
  fireEvent.click(screen.getByRole("button", { name: /Por día/ }));
  assert.ok(screen.getByRole("img", { name: "Calce por día" }));
  assert.ok(screen.getByRole("img", { name: "Cheques a cobrar por semana" }));
});

test("gráfico del calce con los montos de cada columna y la diferencia (19/11)", () => {
  assert.equal(compacto(2500000), "2,5 M");
  assert.equal(compacto(-530000), "−530 mil");
  assert.equal(compacto(250000000), "250 M");
  const g = geometriaColumnas(serieCalce(r.calce.semanal), { linea: true });
  const s1 = g.cols[1];
  assert.equal(s1.montoA.texto, "8 mil");
  assert.equal(s1.montoB.texto, "10 mil");
  assert.equal(s1.dif.texto, "+2 mil");
  assert.equal(g.cols.at(-1).dif, null, "sin movimiento no hay diferencia");
  const h = exportarInformeTesoreria(r).html();
  assert.match(h, />\+2 mil</);
});

test("panorama escrito y tope de renglones para no pasarse de la hoja (20/11)", () => {
  const [fondos, calce, cobrar] = panoramaTexto(r);
  assert.match(fondos, /en cajas y bancos en pesos/);
  assert.match(calce, /faltan|sobran/);
  assert.match(calce, /cheques vencidos/);
  assert.match(cobrar, /la semana del 19\/11 al 25\/11/);
  const muchos = informeTesoreria({ hoy: HOY, tesoreria, operaciones, inversiones, plazos, cheques: Array.from({ length: 60 }, (_, i) => ({ clase: "tercero", estado: "en_cartera", fecha_pago: "2026-12-01", importe: 100 + i, librador: `C${i}` })) });
  const h = exportarInformeTesoreria(muchos).html();
  assert.match(h, new RegExp(`y ${60 - MAX_COBROS} cheques más \\(en el Excel\\)`));
});
