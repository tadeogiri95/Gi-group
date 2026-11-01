// tests/chequeo-base.test.js — Chequeo de la base (auditoría 01/11, PR 7)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  MIGRACIONES, faltantesDesdeIndice, faltantesProbando, textoFaltantes,
} from "../app/lib/esquemaMigraciones.js";
import { chequearEsquema, _limpiarCacheEsquema } from "../app/lib/esquemaServidor.js";

/** Índice OpenAPI con todo lo que piden las migraciones, menos lo que se saque. */
function indice({ sinTabla = [], sinColumna = [], sinFuncion = [] } = {}) {
  const definitions = {};
  const paths = {};
  for (const m of MIGRACIONES) {
    for (const [t, cols] of Object.entries(m.tablas || {})) {
      if (sinTabla.includes(t)) continue;
      definitions[t] ??= { properties: { id: {} } };
      for (const c of cols) if (!sinColumna.includes(`${t}.${c}`)) definitions[t].properties[c] = {};
    }
    for (const f of m.funciones || []) if (!sinFuncion.includes(f)) paths[`/rpc/${f}`] = {};
  }
  return { definitions, paths };
}

test("con todo corrido no falta nada", () => {
  assert.deepEqual(faltantesDesdeIndice(indice()), []);
});

test("detecta tabla, columna y función que faltan", () => {
  const f = faltantesDesdeIndice(indice({ sinTabla: ["reportes_instalacion"], sinColumna: ["retrabajos_ot.anulado_at"], sinFuncion: ["compras_recibir"] }));
  assert.deepEqual(f.map((m) => m.n), [117, 130, 148]);
});

test("un índice vacío no sirve para decidir", () => {
  assert.equal(faltantesDesdeIndice({}), null);
  assert.equal(faltantesDesdeIndice({ definitions: {} }), null);
});

test("plan B tabla por tabla: 404/400 falta, 200 está, otro error corta", async () => {
  const f = await faltantesProbando(async (ruta) => (ruta.startsWith("minutas?") ? 404 : ruta.startsWith("proyectos?select=prioridad") ? 400 : 200));
  assert.deepEqual(f.map((m) => m.n), [137, 150]);
  await assert.rejects(faltantesProbando(async () => 500), /HTTP 500/);
});

test("chequearEsquema usa el índice y, si no está, prueba tabla por tabla", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "k";
  _limpiarCacheEsquema();
  const conIndice = await chequearEsquema({ fetchImpl: async () => ({ ok: true, json: async () => indice({ sinTabla: ["minutas"] }) }) });
  assert.equal(conIndice.metodo, "indice");
  assert.deepEqual(conIndice.faltan, [{ n: 150, archivo: "150_minutas.sql", nombre: "Minutas" }]);

  _limpiarCacheEsquema();
  const rutas = [];
  const sinIndice = await chequearEsquema({
    fetchImpl: async (url) => {
      rutas.push(url);
      if (url.endsWith("/rest/v1/")) return { ok: false, status: 401 };
      return { status: url.includes("/reportes_instalacion?") ? 404 : 200 };
    },
  });
  assert.equal(sinIndice.metodo, "tablas");
  assert.deepEqual(sinIndice.faltan.map((m) => m.n), [117]);
  assert.ok(rutas.every((u) => u.startsWith("https://x.supabase.co/rest/v1/")));
});

test("la memoria evita volver a consultar por 10 minutos", async () => {
  _limpiarCacheEsquema();
  let llamadas = 0;
  const fetchImpl = async () => { llamadas++; return { ok: true, json: async () => indice() }; };
  await chequearEsquema({ fetchImpl, ahora: 1_000_000 });
  await chequearEsquema({ fetchImpl, ahora: 1_000_000 + 60_000 });
  assert.equal(llamadas, 1);
  await chequearEsquema({ fetchImpl, ahora: 1_000_000 + 11 * 60_000 });
  assert.equal(llamadas, 2);
});

test("texto para el aviso", () => {
  assert.equal(textoFaltantes([{ n: 117, nombre: "Reportes de instalación" }]), "117 (Reportes de instalación)");
  assert.equal(
    textoFaltantes([{ n: 97, nombre: "A" }, { n: 117, nombre: "B" }, { n: 150, nombre: "C" }]),
    "097 (A), 117 (B) y 150 (C)",
  );
});

test("toda migración nueva que crea tablas o columnas está en la lista", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const enLista = new Set(MIGRACIONES.map((m) => m.archivo));
  const sinListar = readdirSync(dir)
    .filter((f) => Number(f.slice(0, 3)) >= 97)
    .filter((f) => /create table|add column if not exists|create (or replace )?(view|function)/i.test(readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "")))
    .filter((f) => !enLista.has(f));
  assert.deepEqual(sinListar, [], "Agregá estas migraciones a app/lib/esquemaMigraciones.js");
});
