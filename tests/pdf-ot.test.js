// tests/pdf-ot.test.js — PDF de cada OT desde la carpeta de Drive (04/11)
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
});

const { numeroDePdf, numeroDeOt, pdfsDeOt, indicePdfs, urlDrive, idCarpeta, limpiarArchivos, scriptCarpetaPdf, MAX_PDFS, otDeQr } = await import("../app/lib/pdfOt.js");
const { validateCsrf } = await import("../app/lib/csrf.js");

test("numeroDePdf — los nombres reales de la carpeta", () => {
  assert.equal(numeroDePdf("7498-36-GRUPO ELYON-TORRE AURUS-7º L - FRENTE PLACARD PASILLO.pdf"), "7498-36");
  assert.equal(numeroDePdf("7285-STOM-MALMO-CASAS 9 A 14-COCINAS.pdf"), "7285");
  assert.equal(numeroDePdf("7532 - BCG DPTOS JUNIOR - COCINA TA 1P.pdf"), "7532");
  assert.equal(numeroDePdf("7573-04 - BUGLIOTTI - NARANJO VI - 1ªA - PLACARD.pdf"), "7573-4");
  assert.equal(numeroDePdf("7751-32-URBACONS-OCAMPO-COWORKING-COCINA.pdf"), "7751-32");
  assert.equal(numeroDePdf("7177-GI DESARROLLISTA-CAÑITAS 56-5-MUEBLE TV.pdf"), "7177");
  // Un número después del guion que no es sub-OT (no sigue un guion)
  assert.equal(numeroDePdf("7300-15 MODULOS-COCINA.pdf"), "7300");
  assert.equal(numeroDePdf("7300-2.pdf"), "7300-2");
  assert.equal(numeroDePdf("Copia de seguridad de 7412-NAVARRO.pdf"), null);
  assert.equal(numeroDePdf(""), null);
});

test("numeroDeOt — sin la letra de la división ni ceros de la sub-OT", () => {
  assert.equal(numeroDeOt("M-7498-36"), "7498-36");
  assert.equal(numeroDeOt("m-7495 "), "7495");
  assert.equal(numeroDeOt("M-7573-04"), "7573-4");
  assert.equal(numeroDeOt("7495"), "7495");
  assert.equal(numeroDeOt("M-"), null);
  assert.equal(numeroDeOt(null), null);
});

const archivos = [
  { nombre: "7498-36-GRUPO ELYON-PLACARD.pdf", id: "1aaaaaaaaaaaaaaa", fecha: "2026-10-01T00:00:00.000Z" },
  { nombre: "7498-36-GRUPO ELYON-PLACARD v2.pdf", id: "1bbbbbbbbbbbbbbb", fecha: "2026-10-20T00:00:00.000Z" },
  { nombre: "7498-GRUPO ELYON-GENERAL.pdf", id: "1ccccccccccccccc", fecha: "2026-09-01T00:00:00.000Z" },
  { nombre: "7285-STOM-MALMO-COCINAS.pdf", id: "1ddddddddddddddd", fecha: "2026-09-01T00:00:00.000Z" },
  { nombre: "SIN NUMERO.pdf", id: "1eeeeeeeeeeeeeee", fecha: null },
];

test("pdfsDeOt — el más nuevo primero, con el link de Drive", () => {
  const { pdfs, deLaMadre } = pdfsDeOt("M-7498-36", archivos);
  assert.equal(deLaMadre, false);
  assert.deepEqual(pdfs.map((p) => p.id), ["1bbbbbbbbbbbbbbb", "1aaaaaaaaaaaaaaa"]);
  assert.equal(pdfs[0].url, "https://drive.google.com/file/d/1bbbbbbbbbbbbbbb/view");
  assert.deepEqual(pdfsDeOt("M-7285", archivos).pdfs.map((p) => p.id), ["1ddddddddddddddd"]);
});

test("pdfsDeOt — una sub-OT sin PDF propio ofrece el de la madre; la madre no toma los de sus sub-OT", () => {
  const sub = pdfsDeOt("M-7498-40", archivos);
  assert.equal(sub.deLaMadre, true);
  assert.deepEqual(sub.pdfs.map((p) => p.id), ["1ccccccccccccccc"]);
  assert.deepEqual(pdfsDeOt("M-7498", archivos).pdfs.map((p) => p.id), ["1ccccccccccccccc"]);
  assert.deepEqual(pdfsDeOt("M-9999", archivos), { pdfs: [], deLaMadre: false });
  assert.deepEqual(pdfsDeOt("M-9999-1", archivos), { pdfs: [], deLaMadre: false });
  assert.deepEqual(pdfsDeOt("M-7498-36", null), { pdfs: [], deLaMadre: false });
});

test("indicePdfs — sirve igual que la lista y deja afuera los PDF sin número", () => {
  const indice = indicePdfs(archivos);
  assert.equal(indice.size, 3);
  assert.deepEqual(pdfsDeOt("M-7498-36", indice), pdfsDeOt("M-7498-36", archivos));
});

test("urlDrive e idCarpeta — solo ids de Drive válidos", () => {
  assert.equal(urlDrive("1SuZAKsRpsqnPxVQOOs0-Vz_1BXDw41Ne"), "https://drive.google.com/file/d/1SuZAKsRpsqnPxVQOOs0-Vz_1BXDw41Ne/view");
  assert.equal(urlDrive("x/../../evil"), null);
  assert.equal(urlDrive(null), null);
  assert.equal(idCarpeta("https://drive.google.com/drive/folders/1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d?usp=sharing"), "1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d");
  assert.equal(idCarpeta("https://drive.google.com/open?id=1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d"), "1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d");
  assert.equal(idCarpeta("1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d"), "1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d");
  assert.equal(idCarpeta("cualquier cosa"), null);
});

test("limpiarArchivos — saca ids inválidos y repetidos, y corta en MAX_PDFS", () => {
  const limpio = limpiarArchivos([
    { nombre: "  7285  STOM.pdf ", id: "1ddddddddddddddd", fecha: "2026-09-01T00:00:00Z" },
    { nombre: "7285 STOM.pdf", id: "1ddddddddddddddd" },
    { nombre: "malo.pdf", id: "<script>" },
    { nombre: "", id: "1fffffffffffffff" },
    { nombre: "sin fecha.pdf", id: "1ggggggggggggggg", fecha: "no" },
  ]);
  assert.deepEqual(limpio, [
    { nombre: "7285 STOM.pdf", id: "1ddddddddddddddd", fecha: "2026-09-01T00:00:00.000Z" },
    { nombre: "sin fecha.pdf", id: "1ggggggggggggggg", fecha: null },
  ]);
  const muchos = Array.from({ length: MAX_PDFS + 10 }, (_, i) => ({ nombre: `${7000 + i}.pdf`, id: `1x${String(i).padStart(12, "0")}` }));
  assert.equal(limpiarArchivos(muchos).length, MAX_PDFS);
  assert.deepEqual(limpiarArchivos(null), []);
});

test("scriptCarpetaPdf — lleva la URL, la clave y la carpeta, y manda la lista con PATCH", () => {
  const s = scriptCarpetaPdf({ url: "https://gypi.app/api/proyectos/pdfs", clave: "gyp_x_y", carpeta: "1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d" });
  assert.match(s, /var GYPI_PDF_URL = "https:\/\/gypi.app\/api\/proyectos\/pdfs";/);
  assert.match(s, /var GYPI_PDF_CLAVE = "gyp_x_y";/);
  assert.match(s, /var GYPI_PDF_CARPETA = "1v04XyQRCOu0lPuufO9g-lTIvQRy0YY3d";/);
  assert.match(s, /function instalarPdfGypi\(\)/);
  assert.match(s, /method: "patch"/);
  assert.match(s, /getFilesByType\(MimeType.PDF\)/);
  assert.doesNotMatch(s, /\$\{/);
});

test("csrf — el PATCH del script está exento; el POST de la misma ruta no", () => {
  const req = (method) => ({ method, nextUrl: { pathname: "/api/proyectos/pdfs", host: "gypi.app" }, cookies: { get: () => undefined }, headers: new Headers() });
  assert.equal(validateCsrf(req("PATCH")), null);
  assert.notEqual(validateCsrf(req("POST")), null);
});

test("otDeQr — la OT de cualquier QR de Gypi o de la planilla", () => {
  assert.equal(otDeQr("M-7495"), "M-7495");
  assert.equal(otDeQr(" m-7498-36 "), "m-7498-36");
  assert.equal(otDeQr("OT M-7495 - PIEZA - 1234"), "M-7495");
  assert.equal(otDeQr("OT M-7495 - BULTO 3 DE 4 - M.izq"), "M-7495");
  assert.equal(otDeQr("OT M-7495 - SUELTO - EST-11"), "M-7495");
  assert.equal(otDeQr("OT M-7495 - MODULO - M.izq"), "M-7495");
  assert.equal(otDeQr("https://gypi.app/acme?carga=M-7495&bulto=2"), "M-7495");
  assert.equal(otDeQr("hola que tal"), null);
  assert.equal(otDeQr(""), null);
});
