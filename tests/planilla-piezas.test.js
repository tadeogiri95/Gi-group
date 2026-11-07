// tests/planilla-piezas.test.js — Piezas y módulos de cada OT cargados solos
// desde la carpeta de planillas de despiece (07/11)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
});

const { leerHojaXlsx, hojasXlsx, posicionCelda, decodificarXml } = await import("../app/lib/leerXlsx.js");
const {
  tecnicaLista, limpiarExcels, excelPorOt, excelsPendientes, excelsGrandes, textoDesdePanel, sinCodigo,
  resumenCarga, cargasParaVer, textoCarga, scriptCarpetaPiezas, MAX_BYTES_EXCEL,
} = await import("../app/lib/planillaPiezas.js");
const { leerPiezas, moduloDe } = await import("../app/lib/piezas.js");
const { validateCsrf } = await import("../app/lib/csrf.js");

/** Un .xlsx mínimo, como lo guarda Excel: libro, relaciones, textos compartidos y hojas. */
function xlsx(hojas) {
  const nombres = Object.keys(hojas);
  const compartidos = [];
  const idx = (s) => {
    let i = compartidos.indexOf(s);
    if (i < 0) { compartidos.push(s); i = compartidos.length - 1; }
    return i;
  };
  const col = (n) => { let s = ""; n += 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const archivos = {};
  nombres.forEach((nombre, h) => {
    const filas = hojas[nombre].map((fila, f) => `<row r="${f + 1}">${fila.map((v, c) => {
      if (v === "" || v == null) return "";
      const r = `${col(c)}${f + 1}`;
      if (typeof v === "number") return `<c r="${r}"><v>${v}</v></c>`;
      if (v.startsWith("#")) return `<c r="${r}" t="e"><f>X</f><v>${v}</v></c>`;
      return `<c r="${r}" t="s"><v>${idx(v)}</v></c>`;
    }).join("")}</row>`).join("");
    archivos[`xl/worksheets/sheet${h + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${filas}</sheetData></worksheet>`);
  });
  archivos["xl/workbook.xml"] = strToU8(`<workbook xmlns:r="x"><sheets>${nombres.map((n, i) => `<sheet name="${n.replace(/&/g, "&amp;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  archivos["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships>${nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  archivos["xl/sharedStrings.xml"] = strToU8(`<sst>${compartidos.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  return zipSync(archivos);
}

// La hoja PLANILLA como viene en las planillas de despiece (molde 0000-PLANILLA BASE)
const PLANILLA = [
  [],
  ["", "", "OT", "", "", "", "", 7961],
  [],
  ["", "", "PROYECTO", "", "", "", "", "EDIFICIO MAIPU - COCINA"],
  [], [], [], [], [], [], [],
  ["CONTROL", "", "PANEL", "CORTE", "MEDIDAS SKP", "", "MEDIDAS", "", "", "", "L1 A"],
  ["", "", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "MATERIAL", "L1SKP", "L2SKP", "L1", "L2", "CANT.", "√", "E", "COLOR"],
  ["Z", 328, "2.AL1P-11", "MELAMINA 18MM BLANCO", "", "", 791, 328, 2, "", "0.45-", "GRAFITO"],
  [545, 330, "M1.21", "MELAMINA 18MM GRAFITO", "", "", 545, 330, 1, "", "0", "0"],
  [545, 330, "CENEFA", "MELAMINA 18MM GRAFITO", "", "", 1880, 346, 1, "", "0", "0"],
  ["", "#VALUE!", "", "", "", "", "", "", "", "", "0", "0"],
];

test("leerXlsx — una hoja del Excel por su nombre, con los valores que dejó Excel", () => {
  const b = xlsx({ DATOS: [["IND", "Nª"]], PLANILLA, "PERFILES ": [["x"]] });
  assert.deepEqual(hojasXlsx(b), ["DATOS", "PLANILLA", "PERFILES "]);
  const filas = leerHojaXlsx(b, "planilla");
  assert.equal(filas[1][7], "7961");
  assert.equal(filas[14][2], "2.AL1P-11");
  assert.equal(filas[14][8], "2");
  assert.equal(filas[17][1], "#VALUE!");
  assert.equal(leerHojaXlsx(b, "perfiles")[0][0], "x");
  assert.equal(leerHojaXlsx(b, "NO ESTÁ"), null);
  assert.throws(() => leerHojaXlsx(zipSync({ "a.txt": strToU8("hola") }), "PLANILLA"), /No es un archivo de Excel/);
  assert.deepEqual(posicionCelda("AB12"), { fila: 11, col: 27 });
  assert.equal(posicionCelda("12"), null);
  assert.equal(decodificarXml("A &amp; B &lt;1&gt; &#10;&#x41;"), "A & B <1> \nA");
});

test("leerXlsx — texto con formato (varios runs), en línea, números con decimales feos", () => {
  const archivos = {
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="PLANILLA" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/hoja.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8('<sst><si><r><t>M.</t></r><r><rPr/><t>izq</t></r><rPh><t>X</t></rPh></si><si/></sst>'),
    "xl/worksheets/hoja.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>en línea</t></is></c><c r="D1"><v>0.44999999999999996</v></c><c r="E1" t="b"><v>1</v></c><c r="F1" s="3"/><c r="G1" t="s"><v>1</v></c></row></sheetData></worksheet>'),
  };
  const filas = leerHojaXlsx(zipSync(archivos), "PLANILLA");
  assert.deepEqual(filas[0], ["M.izq", "", "en línea", "0.45", "TRUE"]);
});

test("del Excel a las piezas — desde el renglón de PANEL, con su módulo", () => {
  const texto = textoDesdePanel(leerHojaXlsx(xlsx({ PLANILLA }), "PLANILLA"));
  assert.match(texto.split("\n")[0], /^CONTROL\t\tPANEL/);
  const v = leerPiezas(texto, []);
  assert.deepEqual(v.faltaColumnas, []);
  assert.deepEqual(v.renglones.map((r) => [r.nombre, r.modulo, r.cantidad, r.l1]), [
    ["2.AL1P-11", "2.AL1P", 2, 791], ["M1.21", "M1", 1, 545], ["CENEFA", null, 1, 1880],
  ]);
  assert.deepEqual(sinCodigo(v.renglones), ["CENEFA"]);
  assert.equal(textoDesdePanel([["OT", "7961"], ["CLIENTE"]]), null);
});

test("moduloDe — guion primero; sin guion, lo que va antes del punto si tiene letras", () => {
  assert.equal(moduloDe("M.izq-11"), "M.izq");
  assert.equal(moduloDe("2.AL1P-11"), "2.AL1P");
  assert.equal(moduloDe("M1.11"), "M1");
  assert.equal(moduloDe("CUBO.T1"), "CUBO");
  assert.equal(moduloDe("M1.21/52"), "M1");
  assert.equal(moduloDe("1.5"), null);
  assert.equal(moduloDe("CENEFA"), null);
  assert.equal(moduloDe(".raro"), null);
  assert.equal(moduloDe("-raro"), null);
});

test("Técnica lista — EXCEL del Plan con iniciales; vacío o N/A no", () => {
  assert.equal(tecnicaLista({ excel: { e: "hecho", q: "MJT" } }), true);
  assert.equal(tecnicaLista({ excel: { e: "hecho" } }), true);
  assert.equal(tecnicaLista({ excel: { e: "na" } }), false);
  assert.equal(tecnicaLista({ excel: { e: "falta" } }), false);
  assert.equal(tecnicaLista({ pdf: { e: "hecho" } }), false);
  assert.equal(tecnicaLista(null), false);
});

const lista = limpiarExcels([
  { nombre: "7408-230-BCG-HOTEL AMANCAY-ESCRITORIO.xlsm", id: "1hU6BkDuYOHXQ43raCKBSq", fecha: "2026-11-06T20:29:57.475Z", bytes: 1949144 },
  { nombre: "7961-RIOFRIO IVAN-EDIFICIO MAIPU-DEPTO 10-COCINA.xlsm", id: "1aaaaaaaaaaaaaaaaaaaa", fecha: "2026-10-01T00:00:00.000Z", bytes: 1384399 },
  { nombre: "7961-RIOFRIO IVAN-EDIFICIO MAIPU-DEPTO 10-COCINA-MODIFICACION.xlsm", id: "1QRVGnV5BrXMKGlxwmcuPh", fecha: "2026-11-06T17:47:20.386Z", bytes: 1384399 },
  { nombre: "7751-31-URBACONS-OCAMPO-COWORKING-PUERTA CORREDIZAlsm", id: "178F5mDTCYCpTh-aM45LoU", fecha: "2026-10-21T14:51:13.367Z", bytes: 1992999 },
  { nombre: "7855-MERCEDES 6°D-NARANJO VI-ALACENA.xlsm", id: "1TMiSCoKyCmj1gtDe0_-rZ", fecha: "2026-10-27T13:38:49.381Z", bytes: 1943212 },
  { nombre: "7999-GIGANTE.xlsm", id: "1ggggggggggggggggggggg", fecha: "2026-11-01T00:00:00.000Z", bytes: MAX_BYTES_EXCEL + 1 },
  { nombre: "0000-PLANILLA BASE.xlsm", id: "1bbbbbbbbbbbbbbbbbbbbb", fecha: null },
  { nombre: "sin id", id: "x" },
  { nombre: "repetido", id: "1hU6BkDuYOHXQ43raCKBSq" },
]);
const proyectos = [
  { ot: "M-7408-230", etapas_diseno: { excel: { e: "hecho", q: "SLS" } } },
  { ot: "M-7408", etapas_diseno: { excel: { e: "hecho", q: "SLS" } } },
  { ot: "M-7961", etapas_diseno: { excel: { e: "hecho", q: "MJT" } } },
  { ot: "M-7751-31", etapas_diseno: { excel: { e: "na" } } },
  { ot: "M-7855", etapas_diseno: { excel: { e: "falta" } } },
  { ot: "M-7999", etapas_diseno: { excel: { e: "hecho", q: "MJT" } } },
];

test("cada Excel con su OT — sub-OT exacta y el más nuevo si hay dos", () => {
  assert.equal(lista.length, 7);
  const porOt = excelPorOt(lista, proyectos);
  assert.equal(porOt.get("M-7408-230").id, "1hU6BkDuYOHXQ43raCKBSq");
  assert.equal(porOt.has("M-7408"), false);
  assert.equal(porOt.get("M-7961").id, "1QRVGnV5BrXMKGlxwmcuPh");
  assert.equal(porOt.get("M-7751-31").id, "178F5mDTCYCpTh-aM45LoU");
});

test("qué Excel pedir — Técnica lista, no leídos o cambiados, sin los gigantes", () => {
  assert.deepEqual(excelsPendientes(lista, proyectos, {}).map((p) => p.ot), ["M-7408-230", "M-7961"]);
  const cargas = { "M-7408-230": { id: "1hU6BkDuYOHXQ43raCKBSq", fecha: "2026-11-06T20:29:57.475Z" } };
  assert.deepEqual(excelsPendientes(lista, proyectos, cargas).map((p) => p.ot), ["M-7961"]);
  // La planilla cambió: se vuelve a leer
  const cambio = { "M-7408-230": { id: "1hU6BkDuYOHXQ43raCKBSq", fecha: "2026-11-01T00:00:00.000Z" }, "M-7961": { id: "1aaaaaaaaaaaaaaaaaaaa", fecha: "2026-10-01T00:00:00.000Z" } };
  assert.deepEqual(excelsPendientes(lista, proyectos, cambio).map((p) => p.ot).sort(), ["M-7408-230", "M-7961"]);
  assert.equal(excelsPendientes(lista, proyectos, {}, 1).length, 1);
  assert.deepEqual(Object.keys(excelsPendientes(lista, proyectos, {})[0]), ["ot", "id", "nombre"]);
  assert.deepEqual(excelsGrandes(lista).map((a) => a.nombre), ["7999-GIGANTE.xlsm"]);
});

test("resumen de cada carga para la pantalla", () => {
  const archivo = { id: "1aaaaaaaaaaaaaaaaaaaa", nombre: "7961.xlsm", fecha: "2026-11-06T00:00:00.000Z" };
  const ok = resumenCarga({ archivo, piezas: 41, renglones: 30, modulos: 6, ahora: "2026-11-07T10:00:00.000Z" });
  assert.equal(textoCarga(ok), "41 piezas en 6 módulos");
  const mal = resumenCarga({ archivo, piezas: 3, renglones: 3, modulos: 1, sinCod: ["CENEFA"], errores: [{ fila: 4, motivo: "sin cantidad" }], noBorradas: 2, ahora: "2026-11-07T11:00:00.000Z" });
  assert.equal(textoCarga(mal), "3 piezas en 1 módulo · 1 sin código de módulo · 1 renglón con error · 2 ya no están en la planilla pero tienen escaneos (no se borraron)");
  assert.deepEqual(mal.errores, ["Fila 4: sin cantidad"]);
  const roto = resumenCarga({ archivo, error: "no tiene la hoja PLANILLA", ahora: "2026-11-07T09:00:00.000Z" });
  assert.equal(textoCarga(roto), "No se pudo leer: no tiene la hoja PLANILLA");
  const ver = cargasParaVer({ "M-1": ok, "M-2": mal, "M-3": roto });
  assert.deepEqual(ver.map((c) => [c.ot, c.problema]), [["M-2", true], ["M-1", false], ["M-3", true]]);
});

test("script de Apps Script — Excel de la carpeta, pide y manda, sin template strings", () => {
  const s = scriptCarpetaPiezas({ url: "https://gypi.app/api/piezas/planillas", clave: "gyp_x_y", carpeta: "1xKHlgKCkxWA5BXPYUCwIX0Bc0xA5bNmQ" });
  assert.match(s, /function instalarPiezasGypi\(\)/);
  assert.match(s, /everyMinutes\(15\)/);
  assert.match(s, /accion: "lista"/);
  assert.match(s, /accion: "planilla"/);
  assert.match(s, /base64Encode/);
  assert.match(s, /macroenabled/);
  assert.match(s, /"1xKHlgKCkxWA5BXPYUCwIX0Bc0xA5bNmQ"/);
  assert.doesNotMatch(s, /\$\{/);
});

test("csrf — el PATCH del script está exento; el POST de la misma ruta no", () => {
  const req = (method) => ({ method, nextUrl: { pathname: "/api/piezas/planillas", host: "gypi.app" }, cookies: { get: () => undefined }, headers: new Headers() });
  assert.equal(validateCsrf(req("PATCH")), null);
  assert.notEqual(validateCsrf(req("POST")), null);
});

/* ─── La ruta que llama el script ─── */
const { generarClave } = await import("../app/lib/planillaMrp.js");
const { createFetchMock } = await import("./helpers/mockFetch.js");

test("PATCH /api/piezas/planillas — lista, pide, lee el Excel y no borra piezas escaneadas", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  const { PATCH } = await import("../app/api/piezas/planillas/route.js");
  const E = "11111111-1111-1111-1111-111111111111";
  const { clave, hash } = generarClave(E);
  let config = { hash, carpeta: "1xKHlgKCkxWA5BXPYUCwIX0Bc0xA5bNmQ", cargas: {} };
  const subidas = [];
  const borradas = [];
  global.fetch = createFetchMock([
    { match: (u, o) => u.includes("/config_sistema") && (!o.method || o.method === "GET"), respond: () => ({ body: [{ valor: config }] }) },
    { match: (u, o) => u.includes("/config_sistema") && o.method === "PATCH", respond: (u, o) => { config = JSON.parse(o.body).valor; return { body: [] }; } },
    { match: (u) => u.includes("/proyectos?") && u.includes(`empresa_id=eq.${E}`), respond: () => ({ body: [{ ot: "M-7961", etapas_diseno: { excel: { e: "hecho", q: "MJT" } } }, { ot: "M-7855", etapas_diseno: { excel: { e: "falta" } } }] }) },
    { match: (u) => u.includes("/etapas?"), respond: () => ({ body: [] }) },
    // Ya había dos piezas: VIEJA-1 escaneada y VIEJA-2 sin escanear
    { match: (u, o) => u.includes("/piezas_ot?") && (!o.method || o.method === "GET"), respond: () => ({ body: [{ id: 5, nombre: "VIEJA-1", unidad: 1 }, { id: 6, nombre: "VIEJA-2", unidad: 1 }] }) },
    { match: (u, o) => u.includes("/piezas_ot?on_conflict") && o.method === "POST", respond: (u, o) => { subidas.push(...JSON.parse(o.body)); return { status: 201, body: "" }; } },
    { match: (u) => u.includes("/pasos_pieza?"), respond: () => ({ body: [{ pieza_id: 5 }] }) },
    { match: (u, o) => u.includes("/piezas_ot?") && o.method === "DELETE", respond: (u) => { borradas.push(u); return { status: 204 }; } },
  ]);
  const req = (body, auth = `Bearer ${clave}`) => new Request("http://localhost/api/piezas/planillas", { method: "PATCH", headers: { Authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await PATCH(req({ accion: "lista", archivos: [] }, "Bearer gyp_mal"))).status, 401);

  const archivos = [
    { nombre: "7961-RIOFRIO-COCINA.xlsm", id: "1QRVGnV5BrXMKGlxwmcuPh", fecha: "2026-11-06T17:47:20.386Z", bytes: 1000 },
    { nombre: "7855-MERCEDES-ALACENA.xlsm", id: "1TMiSCoKyCmj1gtDe0_-rZ", fecha: "2026-10-27T13:38:49.381Z", bytes: 1000 },
  ];
  const r1 = await (await PATCH(req({ accion: "lista", archivos }))).json();
  assert.deepEqual(r1.pedir, [{ ot: "M-7961", id: "1QRVGnV5BrXMKGlxwmcuPh", nombre: "7961-RIOFRIO-COCINA.xlsm" }]);
  assert.equal(config.archivos.length, 2);

  const contenido = Buffer.from(xlsx({ PLANILLA })).toString("base64");
  const r2 = await (await PATCH(req({ accion: "planilla", ...archivos[0], contenido }))).json();
  assert.equal(r2.ot, "M-7961");
  assert.equal(r2.piezas, 4);
  assert.deepEqual([...new Set(subidas.map((p) => p.nombre))], ["2.AL1P-11", "M1.21", "CENEFA"]);
  assert.equal(subidas.find((p) => p.nombre === "M1.21").modulo, "M1");
  // VIEJA-2 se borra; VIEJA-1 tiene escaneos y queda
  assert.equal(borradas.length, 1);
  assert.match(borradas[0], /id=in\.\(6\)/);
  const c = config.cargas["M-7961"];
  assert.equal(c.no_borradas, 1);
  assert.deepEqual(c.sin_codigo, ["CENEFA"]);
  assert.equal(c.fecha, "2026-11-06T17:47:20.386Z");

  // Ya leído: la próxima vuelta no lo pide
  const r3 = await (await PATCH(req({ accion: "lista", archivos }))).json();
  assert.deepEqual(r3.pedir, []);

  // Una OT con la Técnica sin terminar no se carga aunque llegue
  const r4 = await (await PATCH(req({ accion: "planilla", ...archivos[1], contenido }))).json();
  assert.equal(r4.ok, false);
  assert.match(r4.motivo, /Técnica/);

  // Un archivo que no es Excel queda anotado con el problema
  const r5 = await (await PATCH(req({ accion: "planilla", ...archivos[0], fecha: "2026-11-07T00:00:00.000Z", contenido: Buffer.from("hola").toString("base64") }))).json();
  assert.equal(r5.ok, false);
  assert.match(config.cargas["M-7961"].error, /no es un Excel/);
});

/* ─── Columnas SUELTO (PR 2) ─── */
const { esSi, piezasSueltasDeDatos, componentesSueltos, tipoComponente, piezasComoSueltos, planSueltos } = await import("../app/lib/sueltosPlanilla.js");

// DATOS como la llena Técnica a mano, con la columna SUELTO al final
const DATOS = [
  ["INFORMACION GENERAL"],
  ["IND", "Nª", "MAT", "L1", "L2", "CANT", "SUELTO"],
  ["Columna1", "Columna2", "Columna3", "Columna4", "Columna5", "Columna6", "Columna7"],
  ["", "2.AL1P-11", "MELAMINA 18MM BLANCO", 791, 328, 2, ""],
  ["", "M1.21", "MELAMINA 18MM GRAFITO", 545, 330, 1, "SI"],
  ["", "CENEFA", "MELAMINA 18MM GRAFITO", 1880, 346, 1, "sí"],
];
// PLANILLA con la lista de NECESIDADES a la derecha (AP-AR en el molde) y SUELTO al lado
const NEC = 13;
const conNecesidades = (sueltoTitulo = "SUELTO") => [...PLANILLA, []].map((fila, i) => {
  const f = [...fila];
  while (f.length < NEC) f.push("");
  if (i === 14) f.push("NOMBRE", "DESCRIPCIÓN", "CANTIDAD", sueltoTitulo);
  if (i === 15) f.push("-", "MELAMINA SOBRE MDF 18MM-Faplac-GRAFITO-4,7M2", 0.2, "");
  if (i === 16) f.push("-", "BISAGRA 35 CODO 0 CIERRE SUAVE-S/Marca-S/COLOR-1 PZ", 4, "");
  if (i === 17) f.push("-", "PERFIL LED DE EMBUTIR-S/Marca-ANODIZADO NATURAL-2MT", 0.5, "SI");
  if (i === 18) f.push("-", "MANIJA BARRAL 128-S/Marca-NEGRO-1 PZ", 6, "x");
  return f;
});

test("SUELTO — qué cuenta como sí", () => {
  for (const v of ["SI", "si", "Sí", "x", "X", "✓"]) assert.equal(esSi(v), true, v);
  for (const v of ["", "NO", "0", "1", "-", null]) assert.equal(esSi(v), false, String(v));
});

test("SUELTO en DATOS — piezas marcadas; sin la columna, null", () => {
  assert.deepEqual([...piezasSueltasDeDatos(DATOS)], ["m121", "cenefa"]);
  assert.equal(piezasSueltasDeDatos(DATOS.map((f) => f.slice(0, 6))), null);
  assert.equal(piezasSueltasDeDatos(null), null);
  const renglones = [{ nombre: "M1.21", modulo: "M1", material: "MELAMINA 18MM GRAFITO", l1: 545, l2: 330, cantidad: 1 }, { nombre: "2.AL1P-11", modulo: "2.AL1P", cantidad: 2 }];
  assert.deepEqual(piezasComoSueltos(renglones, piezasSueltasDeDatos(DATOS)), [
    { tipo: "Madera", codigo: "M1.21", descripcion: "MELAMINA 18MM GRAFITO", medida: "545 × 330", cantidad: 1, va_con: "Módulo M1" },
  ]);
  assert.deepEqual(piezasComoSueltos(renglones, null), []);
});

test("SUELTO en NECESIDADES — herrajes y perfiles marcados; sin la columna, null", () => {
  const items = componentesSueltos(conNecesidades());
  assert.deepEqual(items, [
    { tipo: "Perfil", codigo: null, descripcion: "PERFIL LED DE EMBUTIR-S/Marca-ANODIZADO NATURAL-2MT", medida: "2MT", cantidad: 0.5 },
    { tipo: "Herraje", codigo: null, descripcion: "MANIJA BARRAL 128-S/Marca-NEGRO-1 PZ", medida: "1 PZ", cantidad: 6 },
  ]);
  assert.equal(componentesSueltos(conNecesidades("OTRA COSA")), null);
  assert.equal(componentesSueltos(PLANILLA), null);
  assert.equal(tipoComponente("BISAGRA 35"), "Herraje");
  assert.equal(tipoComponente("LED CALIDO-S/Marca"), "Accesorio");
});

test("planSueltos — no pierde lo tildado ni lo cargado a mano", () => {
  const actuales = [
    { id: 1, tipo: "Herraje", codigo: null, descripcion: "MANIJA", medida: null, cantidad: 4 }, // de la planilla, cambia cantidad
    { id: 2, tipo: "Perfil", codigo: null, descripcion: "PERFIL VIEJO", cantidad: 1 },            // de la planilla, ya no viene
    { id: 3, tipo: "Perfil", codigo: null, descripcion: "PERFIL TILDADO", cantidad: 1, carga: true }, // ya no viene pero está tildado
    { id: 4, tipo: "Accesorio", codigo: null, descripcion: "A MANO", cantidad: 1 },                // cargado a mano
  ];
  const nuevos = [
    { tipo: "Herraje", codigo: null, descripcion: "manija", cantidad: 6, medida: null },
    { tipo: "Accesorio", codigo: null, descripcion: "A MANO", cantidad: 1 },
    { tipo: "Madera", codigo: "CENEFA", descripcion: "MELAMINA", cantidad: 1 },
  ];
  const p = planSueltos(actuales, nuevos, [1, 2, 3]);
  assert.deepEqual(p.crear.map((i) => i.codigo), ["CENEFA"]);
  assert.deepEqual(p.corregir, [{ id: 1, cantidad: 6, medida: null }]);
  assert.deepEqual(p.borrar, [2]);
  assert.deepEqual(p.quedanTildados, [3]);
  assert.deepEqual(p.siguen.sort(), [1, 3]);
});

test("PATCH planilla — con columnas SUELTO arma la hoja de sueltos de la OT", async () => {
  const { PATCH } = await import("../app/api/piezas/planillas/route.js");
  const E = "11111111-1111-1111-1111-111111111111";
  const { clave, hash } = generarClave(E);
  let config = { hash, carpeta: "1xKHlgKCkxWA5BXPYUCwIX0Bc0xA5bNmQ", cargas: {} };
  let sueltos = [{ id: 9, orden: 0, tipo: "Accesorio", codigo: null, descripcion: "A MANO", cantidad: 1 }];
  const creados = [];
  global.fetch = createFetchMock([
    { match: (u, o) => u.includes("/config_sistema") && (!o.method || o.method === "GET"), respond: () => ({ body: [{ valor: config }] }) },
    { match: (u, o) => u.includes("/config_sistema") && o.method === "PATCH", respond: (u, o) => { config = JSON.parse(o.body).valor; return { body: [] }; } },
    { match: (u) => u.includes("/proyectos?"), respond: () => ({ body: [{ ot: "M-7961", etapas_diseno: { excel: { e: "hecho", q: "MJT" } } }] }) },
    { match: (u) => u.includes("/etapas?"), respond: () => ({ body: [] }) },
    { match: (u, o) => u.includes("/piezas_ot?") && (!o.method || o.method === "GET"), respond: () => ({ body: [] }) },
    { match: (u, o) => u.includes("/piezas_ot?on_conflict") && o.method === "POST", respond: () => ({ status: 201, body: "" }) },
    { match: (u, o) => u.includes("/sueltos_ot?") && (!o.method || o.method === "GET"), respond: () => ({ body: sueltos }) },
    { match: (u, o) => u.endsWith("/sueltos_ot") && o.method === "POST", respond: (u, o) => {
      const filas = JSON.parse(o.body).map((f, i) => ({ ...f, id: 100 + creados.length + i }));
      creados.push(...filas);
      return { status: 201, body: filas };
    } },
  ]);
  const archivo = { nombre: "7961-RIOFRIO-COCINA.xlsm", id: "1QRVGnV5BrXMKGlxwmcuPh", fecha: "2026-11-08T10:00:00.000Z" };
  const contenido = Buffer.from(xlsx({ DATOS, PLANILLA: conNecesidades() })).toString("base64");
  const req = new Request("http://localhost/api/piezas/planillas", { method: "PATCH", headers: { Authorization: `Bearer ${clave}`, "content-type": "application/json" }, body: JSON.stringify({ accion: "planilla", ...archivo, contenido }) });
  const r = await (await PATCH(req)).json();
  assert.equal(r.ok, true);
  assert.deepEqual(creados.map((c) => [c.tipo, c.codigo || c.descripcion]), [
    ["Madera", "M1.21"], ["Madera", "CENEFA"], ["Perfil", "PERFIL LED DE EMBUTIR-S/Marca-ANODIZADO NATURAL-2MT"], ["Herraje", "MANIJA BARRAL 128-S/Marca-NEGRO-1 PZ"],
  ]);
  assert.equal(creados[0].orden, 1);
  const c = config.cargas["M-7961"];
  assert.deepEqual(c.sueltos.ids, [100, 101, 102, 103]);
  assert.equal(c.sueltos.componentes, 2);
  assert.match(textoCarga(c), /4 sueltos para la carga/);
});
