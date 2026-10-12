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
