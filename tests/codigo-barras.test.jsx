// tests/codigo-barras.test.jsx — Código de barras de las piezas (06/11, Tadeo):
// la máquina de etiquetas imprime código de barras, no QR. El código es
// OT-Módulo-Pieza, "M7819-GB2P-11", y se lee con la cámara de Gypi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { modulosCode128, svgBarras, entraEnBarras, textoBarrasPieza, leerBarrasPieza, otParaBarras } = await import("../app/lib/codigoBarras.js");
const { leerQrPieza, htmlEtiquetasPiezas } = await import("../app/lib/piezas.js");
const { leerQr, cotejarQr, otDelQr } = await import("../app/lib/escaneoCarga.js");
const { otDeQr } = await import("../app/lib/pdfOt.js");

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("Code 128 — inicio B, control y fin; mismo resultado que el estándar", () => {
  // "M7819-GB2P-11" armado a mano: inicio B (104), letras, control, fin
  const bits = modulosCode128("M7819-GB2P-11");
  assert.ok(bits.startsWith("11010010000"), "empieza con el inicio B");
  assert.ok(bits.endsWith("1100011101011"), "termina con el fin");
  assert.equal(bits.length, (13 + 2) * 11 + 13);
  // Ejemplo conocido: "A" = inicio B (104) + 33 + control (104+33)%103=34 + fin
  assert.equal(modulosCode128("A"), "11010010000" + "10100011000" + "10001011000" + "1100011101011");
});

test("Code 128 — solo letras sin tilde, números y signos; si no, null", () => {
  assert.ok(entraEnBarras("M7819-GB2P-11"));
  assert.ok(entraEnBarras("M7819-2.AL1P-11"));
  assert.equal(entraEnBarras("Puño"), false);
  assert.equal(entraEnBarras(""), false);
  assert.equal(entraEnBarras("x".repeat(61)), false);
  assert.equal(svgBarras("Puño"), null);
  const svg = svgBarras("M7819-GB2P-11");
  assert.match(svg, /^<svg [^>]*viewBox="0 0 198 1"/, "178 módulos + 10 de margen a cada lado");
  assert.match(svg, /preserveAspectRatio="none"/);
});

test("código de la pieza — OT sin el guion de adentro + nombre de la planilla", () => {
  assert.equal(otParaBarras("M-7819"), "M7819");
  assert.equal(otParaBarras("m-7498-36"), "M7498-36");
  assert.equal(otParaBarras("7961"), "7961");
  assert.equal(textoBarrasPieza("M-7819", "GB2P-11"), "M7819-GB2P-11");
});

test("leer el código — con o sin guion en la OT; la OT sola sigue siendo la OT", () => {
  assert.deepEqual(leerBarrasPieza("M7819-GB2P-11"), [{ ot: "M-7819", nombre: "GB2P-11" }]);
  assert.deepEqual(leerBarrasPieza(" m-7819-GB2P-11 "), [{ ot: "M-7819", nombre: "GB2P-11" }]);
  assert.deepEqual(leerBarrasPieza("M7819-2.AL1P-11"), [{ ot: "M-7819", nombre: "2.AL1P-11" }]);
  assert.deepEqual(leerBarrasPieza("7961-GB2P-11"), [{ ot: "7961", nombre: "GB2P-11" }]);
  // Sub-OT: dos lecturas, primero la sub-OT
  assert.deepEqual(leerBarrasPieza("M7498-36-GB2P-11"), [
    { ot: "M-7498-36", nombre: "GB2P-11" },
    { ot: "M-7498", nombre: "36-GB2P-11" },
  ]);
  for (const t of ["M-7498-36", "M-7495", "M7495", "OT M-7495 - PIEZA - X", "7790001234567", ""]) {
    assert.equal(leerBarrasPieza(t), null, t);
  }
});

test("Escanear piezas — el código de barras es el renglón (cada lectura suma una)", () => {
  assert.deepEqual(leerQrPieza("M7819-GB2P-11"), { ot: "M-7819", nombre: "GB2P-11" });
  assert.deepEqual(leerQrPieza("M7498-36-GB2P-11"), { ot: "M-7498-36", nombre: "GB2P-11", otras: [{ ot: "M-7498", nombre: "36-GB2P-11" }] });
  // Los QR de siempre siguen igual
  assert.deepEqual(leerQrPieza("OT M-7495 - PIEZA - 1234"), { ot: "M-7495", id: 1234 });
  assert.deepEqual(leerQrPieza("OT M-7495 - PIEZA - M.izq-11"), { ot: "M-7495", nombre: "M.izq-11" });
  const ruta = leer("app/api/piezas/paso/route.js");
  assert.match(ruta, /lectura\.otras \|\| \[\]/, "con sub-OT prueba la otra lectura");
});

test("Carga y Ver PDF — el código de barras trae la OT y la pieza", () => {
  assert.deepEqual(leerQr("M7819-GB2P-11"), { ot: "M-7819", piezaNombre: "GB2P-11" });
  assert.deepEqual(leerQr("M-7495"), { ot: "M-7495" }, "la OT sola no cambia");
  assert.equal(otDeQr("M7819-GB2P-11"), "M-7819");
  assert.equal(otDelQr("M7498-36-GB2P-11", [{ ot: "M-7498" }]), "M-7498");
  assert.equal(otDelQr("M7498-36-GB2P-11", [{ ot: "M-7498-36" }, { ot: "M-7498" }]), "M-7498-36");
  const sueltos = [{ id: 1, codigo: "GB2P-11", descripcion: "Estante", carga: null }];
  const r = cotejarQr("M7819-GB2P-11", { ot: "M-7819", bultos: [], sueltos });
  assert.equal(r.tipo, "suelto");
  assert.equal(r.item.id, 1);
  const sub = cotejarQr("M7498-36-GB2P-11", { ot: "M-7498-36", bultos: [], sueltos });
  assert.equal(sub.tipo, "suelto", "vale la lectura de la OT abierta");
  assert.match(cotejarQr("M7820-GB2P-11", { ot: "M-7819", bultos: [], sueltos }).error, /OT M-7820/);
});

test("cámara — por defecto lee QR y código de barras", () => {
  const escaner = leer("app/components/EscanerCodigo.jsx");
  assert.match(escaner, /FORMATOS = \["qr_code", "code_128", "code_39"\]/);
  assert.match(escaner, /formatos = FORMATOS/);
});

test("etiquetas de 🧩 Piezas — código de barras abajo con el texto legible", async () => {
  const html = await htmlEtiquetasPiezas({ ot: "M-7819", piezas: [{ id: 5, nombre: "GB2P-11", modulo: "GB2P", unidad: 1, de: 3 }], tamano: { ancho: 50, alto: 30 } });
  assert.match(html, /class="etiqueta con-barras"/);
  assert.match(html, /data-barras="M7819-GB2P-11"/);
  assert.match(html, /<div class="codigo">M7819-GB2P-11<\/div>/);
  assert.match(html, /Cant\. 3/);
  // Con ñ o tildes no entra en barras: va el QR de siempre
  const conEnie = await htmlEtiquetasPiezas({ ot: "M-7819", piezas: [{ id: 6, nombre: "Puño", unidad: 1, de: 1 }], tamano: { ancho: 50, alto: 30 } });
  assert.doesNotMatch(conEnie, /class="etiqueta con-barras"/);
  assert.match(conEnie, /class="qr"/);
});
