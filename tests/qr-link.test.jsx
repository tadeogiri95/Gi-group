// tests/qr-link.test.jsx — QR de Gypi como link (04/11): leído con la cámara
// del celular abre Gypi en la OT, el módulo o la pieza; leído desde adentro de
// Gypi vale lo mismo que el texto solo.
import "./helpers/domSetup.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { textoDeQr, linkQr } from "../app/lib/linkQr.js";
import { leerQrPieza, leerQrModulo, htmlEtiquetasPiezas, htmlEtiquetasModulos } from "../app/lib/piezas.js";
import { leerQr } from "../app/lib/escaneoCarga.js";
import { otDeQr } from "../app/lib/pdfOt.js";
import { pasoPiezaBody } from "../app/lib/schemas.ts";

const { default: QrAbierto, queEsQr } = await import("../app/components/QrAbierto.jsx");
const { olvidarPdfsOt } = await import("../app/hooks/usePdfsOt.js");
const { olvidarOts } = await import("../app/hooks/useOts.js");

const L = (texto) => linkQr("https://gypi.app", "gi", texto);

beforeEach(() => { olvidarPdfsOt(); olvidarOts(); global.fetch = async () => new Response("[]", { status: 200 }); });
afterEach(() => cleanup());

test("linkQr / textoDeQr — el texto va y vuelve igual", () => {
  const texto = "OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2";
  assert.equal(L(texto), "https://gypi.app/gi?qr=OT%20M-7961%20-%20PIEZA%20-%202.AL1P-11%20-%201%20DE%202");
  assert.equal(textoDeQr(L(texto)), texto);
  // Como lo arma Excel con ENCODEURL, o con + en vez de espacios
  assert.equal(textoDeQr("https://gypi.app/gi?qr=OT+M-7961+-+MODULO+-+2.AL1P"), "OT M-7961 - MODULO - 2.AL1P");
  assert.equal(textoDeQr(" M-7961 "), "M-7961");
  assert.equal(textoDeQr("https://gypi.app/gi?carga=M-7961"), "https://gypi.app/gi?carga=M-7961", "otros links quedan igual");
  assert.equal(textoDeQr("https://gypi.app/gi?qr=" + "x".repeat(400)).startsWith("https://"), true, "uno muy largo no se toma");
});

test("adentro de Gypi el link vale lo mismo que el texto (piezas, módulo, carga, PDF)", () => {
  assert.deepEqual(leerQrPieza(L("OT M-7961 - PIEZA - 1234")), { ot: "M-7961", id: 1234 });
  assert.deepEqual(leerQrPieza(L("OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2")), { ot: "M-7961", nombre: "2.AL1P-11", unidad: 1, de: 2 });
  assert.deepEqual(leerQrModulo(L("OT M-7961 - MODULO - 2.AL1P")), { ot: "M-7961", modulo: "2.AL1P" });
  assert.deepEqual(leerQr(L("OT M-7961 - BULTO 1 DE 2 - 2.AL1P")), { ot: "M-7961", bulto: 1 });
  assert.deepEqual(leerQr(L("M-7961")), { ot: "M-7961" });
  assert.equal(otDeQr(L("OT M-7961 - MODULO - 2.AL1P")), "M-7961");
  assert.ok(pasoPiezaBody.safeParse({ accion: "escanear", codigo: L("OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2"), etapa: 2 }).success);
});

test("queEsQr — pieza, módulo, OT o nada", () => {
  assert.deepEqual(queEsQr(L("OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2")), { tipo: "pieza", ot: "M-7961", titulo: "Pieza 2.AL1P-11 (1 de 2)" });
  assert.deepEqual(queEsQr("OT M-7961 - PIEZA - 77"), { tipo: "pieza", ot: "M-7961", titulo: "Pieza N° 77" });
  assert.deepEqual(queEsQr(L("OT M-7961 - MODULO - 2.AL1P")), { tipo: "modulo", ot: "M-7961", titulo: "Módulo 2.AL1P" });
  assert.deepEqual(queEsQr(L("M-7961")), { tipo: "ot", ot: "M-7961", titulo: "OT M-7961" });
  assert.equal(queEsQr("hola mundo"), null);
});

test("QrAbierto — pieza: botón para anotarla en una etapa con el texto de adentro", async () => {
  let anotado = null;
  render(<QrAbierto texto={L("OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2")} onAnotar={(t) => { anotado = t; }} onCarga={() => {}} onClose={() => {}} />);
  assert.ok(screen.getByText("M-7961"));
  fireEvent.click(screen.getByRole("button", { name: /Anotar la pieza en una etapa/ }));
  assert.equal(anotado, "OT M-7961 - PIEZA - 2.AL1P-11 - 1 DE 2");
  assert.equal(screen.queryByRole("button", { name: /Carga de la OT/ }), null);
});

test("QrAbierto — OT: abre la carga; un QR que no es de Gypi lo dice", () => {
  let carga = null;
  render(<QrAbierto texto={L("M-7961")} onAnotar={() => {}} onCarga={(ot) => { carga = ot; }} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Carga de la OT/ }));
  assert.equal(carga, "M-7961");
  assert.equal(screen.queryByRole("button", { name: /Anotar/ }), null);
  cleanup();
  render(<QrAbierto texto="hola mundo" onAnotar={() => {}} onCarga={() => {}} onClose={() => {}} />);
  assert.ok(screen.getByText(/no es de una OT, un módulo ni una pieza/));
});

test("etiquetas de Gypi — con link, el QR lleva el link de la empresa", async () => {
  const tamano = { ancho: 50, alto: 30 };
  // Las piezas llevan código de barras (06/11); el QR queda para nombres con ñ o tildes
  const sinLink = await htmlEtiquetasPiezas({ ot: "M-7961", piezas: [{ id: 5, nombre: "Puño", unidad: 1, de: 1 }], tamano });
  const conLink = await htmlEtiquetasPiezas({ ot: "M-7961", piezas: [{ id: 5, nombre: "Puño", unidad: 1, de: 1 }], tamano, link: { origen: "https://gypi.app", slug: "gi" } });
  assert.notEqual(sinLink, conLink, "el QR cambia con el link");
  const mod = await htmlEtiquetasModulos({ ot: "M-7961", modulos: [{ modulo: "M1", piezas: 2 }], tamano, link: { origen: "https://gypi.app", slug: "" } });
  const modSin = await htmlEtiquetasModulos({ ot: "M-7961", modulos: [{ modulo: "M1", piezas: 2 }], tamano });
  assert.equal(mod, modSin, "sin slug queda el texto solo");
  const pantalla = readFileSync(new URL("../app/components/PiezasOt.jsx", import.meta.url), "utf8");
  assert.equal((pantalla.match(/link: \{ origen: window\.location\.origin, slug: empresa\?\.slug/g) || []).length, 2);
});

test("HomeContent — ?qr= abre QrAbierto y ?anotar= abre Escanear piezas con el código", () => {
  const src = readFileSync(new URL("../app/[slug]/HomeContent.jsx", import.meta.url), "utf8");
  assert.match(src, /textoQr\("qr"\)/);
  assert.match(src, /<QrAbierto texto=\{qrAbierto\}/);
  assert.match(src, /<EscanearPiezas usuario=\{u\} etapas=\{etapasEmpresa\} codigoInicial=\{qrAnotar\}/);
});
