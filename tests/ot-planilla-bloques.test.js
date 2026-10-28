// tests/ot-planilla-bloques.test.js — Planilla de OT armada con bloques de varias hojas
// Caso real: faltaban OT en el listado. Una OT repetida hacía que la base
// rechazara el lote entero de 100; los títulos repetidos creaban una OT "OT";
// una celda con salto de línea partía la fila.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { parseCsvProyectos, filasCsv } from "../app/lib/csvProyectos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const PLANILLA = [
  "OT,Cliente,Obra,Proyecto,División",
  "101,Ana,Casa,Cocina,Muebles",
  ",,,,",
  ",,,,",
  "OT,Cliente,Obra,Proyecto,División",
  '102,"Pérez, SA","Local',
  'planta baja",Barra,Muebles',
  '103,"Dice ""hola""",,Placard,',
  "",
  "101,,Casa 2,,",
].join("\r\n");

test("filasCsv — saltos de línea y comillas dentro de una celda", () => {
  const filas = filasCsv('a,b\n"x\ny","z ""q"""\n');
  assert.deepEqual(filas, [["a", "b"], ["x\ny", 'z "q"']]);
});

test("planilla en bloques — sin filas vacías, sin OT 'OT' y una fila por OT", () => {
  const { filas, repetidas } = parseCsvProyectos(PLANILLA);
  assert.deepEqual(filas.map(f => f.ot).sort(), ["101", "102", "103"]);
  assert.equal(repetidas, 1);
  const f102 = filas.find(f => f.ot === "102");
  assert.equal(f102.cliente, "Pérez, SA");
  assert.equal(f102.obra, "Local planta baja");
  assert.equal(f102.proyecto, "Barra");
  assert.equal(filas.find(f => f.ot === "103").cliente, 'Dice "hola"');
  // La OT repetida toma la última fila y completa lo vacío con la anterior
  const f101 = filas.find(f => f.ot === "101");
  assert.equal(f101.obra, "Casa 2");
  assert.equal(f101.cliente, "Ana");
  assert.equal(f101.proyecto, "Cocina");
});

test("planilla — prefiere la columna llamada exactamente OT aunque otra la contenga", () => {
  const { filas } = parseCsvProyectos("Notas,OT,Cliente\nurgente,200,Luis\n");
  assert.deepEqual(filas.map(f => f.ot), ["200"]);
});

test("sync-csv — la base nunca recibe la misma OT dos veces en un lote", async () => {
  const CSV_URL = "https://files.example.com/ot.csv";
  const filasCsvGrande = ["OT,Cliente"];
  for (let i = 0; i < 150; i++) filasCsvGrande.push(`${i},C${i}`);
  filasCsvGrande.push("OT,Cliente", "5,Repetida");
  const lotes = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: filasCsvGrande.join("\n") }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: (u, o) => { lotes.push(JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.procesados, 150);
  assert.equal(json.repetidas, 1);
  assert.deepEqual(json.errores, []);
  const todas = lotes.flat().map(r => r.ot);
  assert.equal(new Set(todas).size, todas.length, "sin OT repetidas");
  assert.ok(!todas.includes("OT"));
  for (const lote of lotes) assert.equal(new Set(lote.map(r => r.ot)).size, lote.length);
  assert.equal(lotes.flat().find(r => r.ot === "5").cliente, "Repetida");
});

// ─── Cliente, obra y descripción (columnas D, E y F de la planilla) ─────────
const PLANILLA_REAL = [
  "OT,DIVISIÓN,PROYECTO / N°,CLIENTE,OBRA,DESCRIPCION,CANT,PPTO,ENTREGA,INFO PROY,N.P",
  "M-7495,MUEBLES,7495,SICILIANO ROMINA,CASA REMODELACION,MUEBLE DIVISOR,1,,1/05/2026,GR,",
].join("\n");

test("planilla real — lee cliente, obra y descripción", () => {
  const { filas } = parseCsvProyectos(PLANILLA_REAL);
  assert.deepEqual(filas, [{
    ot: "M-7495", cliente: "SICILIANO ROMINA", obra: "CASA REMODELACION",
    proyecto: "7495", division: "MUEBLES", descripcion: "MUEBLE DIVISOR",
    fecha_entrega: "2026-05-01", cantidad: 1, terminado_planilla: null, semana_objetivo: null,
  }]);
});

test("sync-csv — sin la columna descripcion en la base (falta la 091) igual sincroniza", async () => {
  const CSV_URL = "https://files.example.com/ot.csv";
  const cuerpos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: PLANILLA_REAL }) },
    {
      match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST",
      respond: (u, o) => {
        const lote = JSON.parse(o.body);
        cuerpos.push(lote);
        if ("descripcion" in lote[0]) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'descripcion' column of 'proyectos' in the schema cache" } };
        return { status: 200, body: null };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  const json = await res.json();
  assert.equal(json.procesados, 1);
  assert.deepEqual(json.errores, []);
  assert.equal(cuerpos.length, 2, "reintenta una vez sin la descripción");
  assert.equal(cuerpos[1][0].ot, "M-7495");
});

test("lista del empleado — ordena por número de OT, de la más nueva a la más vieja", async () => {
  const { ordenarPorOt } = await import("../app/hooks/useActividad.js");
  const lista = ordenarPorOt([{ ot: "M-120" }, { ot: "M-7495" }, { ot: "C-8000" }, { ot: "905" }]);
  assert.deepEqual(lista.map(p => p.ot), ["C-8000", "M-7495", "905", "M-120"]);
});

// ─── Planilla "DB PROYECTOS" real: títulos y renglones como los de producción ──
const DB_PROYECTOS = [
  "OT,DIVISIÓN,PROYECTO / OBRA,CLIENTE ,OBRA,DESCRIPCION,CANT",
  "M-7100,MUEBLES ,7100,BCG,HOTEL AMANCAY,P1 - PUERTA DE INGRESO + REV,107",
  "M-7100,MUEBLES ,7100,BCG,HOTEL AMANCAY,P3 - PUERTA CERRADURA SIMPLE,17",
  "M-7100,MUEBLES ,7100,BCG,HOTEL AMANCAY,P1 - PUERTA DE INGRESO + REV,1",
  "M-,,,,,,",
  "-,,,,,,",
  "M-7495,MUEBLES ,7495,SICILIANO ROMINA,CASA REMODELACIÓN,MUEBLE DIVISORIO TV,1",
].join("\n");

test("DB PROYECTOS — 'OBRA' es la columna E, no 'PROYECTO / OBRA'", () => {
  const { filas } = parseCsvProyectos(DB_PROYECTOS);
  const f = filas.find(x => x.ot === "M-7495");
  assert.equal(f.obra, "CASA REMODELACIÓN");
  assert.equal(f.proyecto, "7495");
  assert.equal(f.cliente, "SICILIANO ROMINA");
});

test("DB PROYECTOS — saltea renglones sin número ('M-', '-') y junta los ítems de una OT", () => {
  const { filas, repetidas } = parseCsvProyectos(DB_PROYECTOS);
  assert.deepEqual(filas.map(f => f.ot), ["M-7100", "M-7495"]);
  assert.equal(repetidas, 2);
  assert.equal(filas[0].descripcion, "P1 - PUERTA DE INGRESO + REV / P3 - PUERTA CERRADURA SIMPLE");
});

// ─── Hojas de cada obra (OCAMPOURB, MALMÖ…) ─────────────────────────────────
// Caso real: la M-7751-29 no aparecía. En la hoja PLAN la obra tiene un solo
// renglón ("M-7751") y sus OT están en la hoja OCAMPOURB, con los títulos en
// la fila 3 como PLAN. Cada hoja se publica aparte y se pegan varios links.
const HOJA_PLAN = [
  " ,N° SIGUIENTE,7967,SEMANA,44",
  "M,A,H,27/10/2026,205",
  "OT,DIVISIÓN,PROYECTO / OBRA,CLIENTE,OBRA,DESCRIPCION,CANT,TERMINADO",
  "M-7751,MUEBLES ,7751,URBACONS,OCAMPO,,,NO",
  "M-7100,MUEBLES ,7100,BCG,HOTEL AMANCAY,P1 - PUERTA DE INGRESO,107,SI",
].join("\n");
const HOJA_OCAMPO = [
  "I,#NUM!,NUMERO SIGUIENTE,SEMANA,0",
  "27/10/2026,0,3,3,0",
  "OT,DIVISIÓN,PROYECTO / OBRA,CLIENTE,OBRA,DESCRIPCION,CANT,TERMINADO",
  "M-7751-28,MUEBLES ,7751-28,URBACONS,OCAMPO,PLACARES DORMITORIOS,20,SI",
  "M-7751-29,MUEBLES ,7751-29,URBACONS,OCAMPO,MUEBLE CALDERA,10,NO",
  "M-7100,MUEBLES ,7100,BCG,HOTEL AMANCAY,P1 - PUERTA DE INGRESO,107,SI",
].join("\n");

test("hoja de obra — los títulos en la fila 3 (arriba van contadores)", () => {
  const { filas } = parseCsvProyectos(HOJA_OCAMPO);
  assert.deepEqual(filas.map(f => f.ot), ["M-7751-28", "M-7751-29", "M-7100"]);
  const f29 = filas.find(f => f.ot === "M-7751-29");
  assert.equal(f29.descripcion, "MUEBLE CALDERA");
  assert.equal(f29.cantidad, 10);
  assert.equal(f29.terminado_planilla, false);
});

test("links de la planilla — uno por renglón, el principal primero y sin repetir", async () => {
  const { linksPlanilla, valorLinks } = await import("../app/lib/csvProyectos.js");
  assert.deepEqual(linksPlanilla({ url: "https://a" }), ["https://a"]);
  assert.deepEqual(linksPlanilla({ url: "https://a", urls: ["https://b", " https://a ", ""] }), ["https://a", "https://b"]);
  assert.deepEqual(linksPlanilla(null), []);
  assert.deepEqual(valorLinks("https://a\n\n  https://b \nhttps://a\n"), { url: "https://a", urls: ["https://b"] });
  assert.deepEqual(valorLinks(""), { url: "", urls: [] });
});

function mockVariasHojas({ valor, hojas, lotes, configs }) {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: (u) => ({ status: 200, body: u.includes("proyectos_csv_url") ? [{ valor }] : [] }) },
    { match: (u) => u in hojas, respond: (u) => hojas[u] },
    { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: (u, o) => { lotes.push(JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: (u, o) => { configs.push(JSON.parse(o.body)); return { status: 200, body: null }; } },
  ]);
}

test("sync-csv — junta la hoja PLAN y las hojas de cada obra", async () => {
  const PLAN = "https://files.example.com/plan.csv";
  const OCAMPO = "https://files.example.com/ocampo.csv";
  const lotes = [];
  const configs = [];
  mockVariasHojas({
    valor: { url: PLAN, urls: [OCAMPO] },
    hojas: { [PLAN]: { status: 200, body: HOJA_PLAN }, [OCAMPO]: { status: 200, body: HOJA_OCAMPO } },
    lotes, configs,
  });
  const { syncEmpresa } = await import("../app/lib/syncOt.js");
  const r = await syncEmpresa("11111111-1111-1111-1111-111111111111");
  assert.deepEqual(r.errores, []);
  assert.equal(r.hojas, 2);
  const ots = lotes.flat().map(f => f.ot).sort();
  assert.deepEqual(ots, ["M-7100", "M-7751", "M-7751-28", "M-7751-29"]);
  // La OT que está en las dos hojas va una sola vez y no suma su cantidad dos veces
  assert.equal(r.enVariasHojas, 1);
  assert.equal(lotes.flat().find(f => f.ot === "M-7100").cantidad, 107);
  // Guardar la fecha de la sync no borra los links de las otras hojas
  assert.deepEqual(configs[0].valor.urls, [OCAMPO]);
  assert.equal(configs[0].valor.url, PLAN);
});

test("sync-csv — si una hoja de obra no se puede leer, sincroniza las demás y avisa", async () => {
  const PLAN = "https://files.example.com/plan.csv";
  const MAL = "https://files.example.com/sin-publicar.csv";
  const lotes = [];
  mockVariasHojas({
    valor: { url: PLAN, urls: [MAL] },
    hojas: { [PLAN]: { status: 200, body: HOJA_PLAN }, [MAL]: { status: 404, body: "no" } },
    lotes, configs: [],
  });
  const { syncEmpresa } = await import("../app/lib/syncOt.js");
  const r = await syncEmpresa("11111111-1111-1111-1111-111111111111");
  assert.deepEqual(lotes.flat().map(f => f.ot).sort(), ["M-7100", "M-7751"]);
  assert.equal(r.procesados, 2);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /^Hoja 2: /);
});

test("sync-csv — si la hoja principal no se puede leer, no sincroniza", async () => {
  const PLAN = "https://files.example.com/plan.csv";
  const OCAMPO = "https://files.example.com/ocampo.csv";
  const lotes = [];
  mockVariasHojas({
    valor: { url: PLAN, urls: [OCAMPO] },
    hojas: { [PLAN]: { status: 404, body: "no" }, [OCAMPO]: { status: 200, body: HOJA_OCAMPO } },
    lotes, configs: [],
  });
  const { syncEmpresa } = await import("../app/lib/syncOt.js");
  await assert.rejects(syncEmpresa("11111111-1111-1111-1111-111111111111"), /HTTP 404/);
  assert.equal(lotes.length, 0);
});
