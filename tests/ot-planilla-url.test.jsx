// tests/ot-planilla-url.test.jsx — Guardar el enlace de la planilla de OT.
// El botón "Guardar URL" pedía config_sistema?select=id, columna que no existe
// en producción (la tabla es clave, valor, empresa_id): PostgREST lo rechazaba
// y el enlace nunca se guardaba. Además la clave primaria era solo `clave`, así
// que dos empresas no podían tener cada una su planilla (migración 090).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { default: ProyectosScreen } = await import("../app/proyectos_screen.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");

const raiz = new URL("../supabase/", import.meta.url);
const base = readFileSync(new URL("baseline/esquema-base.sql", raiz), "utf8");

// Columnas reales de config_sistema según la línea base de producción.
const COLUMNAS = base.match(/CREATE TABLE public\.config_sistema \(([\s\S]*?)\);/)[1]
  .split("\n").map((l) => l.trim().split(" ")[0]).filter(Boolean);

afterEach(() => cleanup());

// Simula /api/data + PostgREST: rechaza un select con columnas que no existen.
function mockApi(pedidos) {
  return async (url, opts = {}) => {
    const { method, path, body } = JSON.parse(opts.body || "{}");
    pedidos.push({ method, path, body });
    const [tabla, query = ""] = path.split("?");
    const select = new URLSearchParams(query).get("select");
    if (tabla === "config_sistema" && select) {
      const faltan = select.split(",").filter((c) => !COLUMNAS.includes(c));
      if (faltan.length) return new Response(JSON.stringify({ error: `column config_sistema.${faltan[0]} does not exist` }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
  };
}

test("la línea base confirma el problema: config_sistema no tiene id y su clave primaria es solo `clave`", () => {
  assert.deepEqual(COLUMNAS, ["clave", "valor", "empresa_id"]);
  assert.match(base, /ADD CONSTRAINT config_sistema_pkey PRIMARY KEY \(clave\);/);
});

test("Guardar URL — guarda el enlace de la planilla sin pedir columnas inexistentes", async () => {
  const pedidos = [];
  global.fetch = mockApi(pedidos);
  render(
    <AuthContext.Provider value={{ divisiones: [], empresa: { nombre: "Acme" }, updateEmpresa: () => {} }}>
      <ProyectosScreen empresaId="11111111-1111-1111-1111-111111111111" />
    </AuthContext.Provider>
  );

  fireEvent.click(await screen.findByText(/Sincronización automática/));
  fireEvent.change(screen.getByPlaceholderText(/docs\.google\.com/), { target: { value: "https://docs.google.com/x/export?format=csv" } });
  fireEvent.click(screen.getByText("Guardar URL"));

  await waitFor(() => assert.ok(pedidos.some((p) => p.method === "POST" && p.path === "config_sistema")));
  const post = pedidos.find((p) => p.method === "POST" && p.path === "config_sistema");
  assert.deepEqual(post.body, { clave: "proyectos_csv_url", valor: { url: "https://docs.google.com/x/export?format=csv" } });
});

test("090 — la clave primaria pasa a (empresa_id, clave), solo si todavía es la vieja", () => {
  const sql = readFileSync(new URL("migrations/090_config_por_empresa.sql", raiz), "utf8");
  assert.match(sql, /array_length\(conkey, 1\) = 1/);
  assert.match(sql, /drop constraint config_sistema_pkey/);
  assert.match(sql, /add constraint config_sistema_pkey primary key \(empresa_id, clave\)/);
});

test("listado de OT — trae todas las páginas, no se corta en 500", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    const { method, path } = JSON.parse(opts.body || "{}");
    pedidos.push({ method, path });
    if (path.startsWith("proyectos?")) {
      const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset") || 0);
      const n = offset === 0 ? 1000 : offset === 1000 ? 200 : 0;
      const data = Array.from({ length: n }, (_, i) => ({ id: `p${offset + i}`, ot: `OT-${offset + i}`, estado: "activo" }));
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 });
  };
  render(
    <AuthContext.Provider value={{ divisiones: [], empresa: { nombre: "Acme" }, updateEmpresa: () => {} }}>
      <ProyectosScreen empresaId="11111111-1111-1111-1111-111111111111" />
    </AuthContext.Provider>
  );
  await waitFor(() => assert.ok(pedidos.some((p) => p.path.startsWith("proyectos?") && p.path.includes("offset=1000"))));
  assert.ok(pedidos.every((p) => !p.path.includes("limit=500")));
  assert.ok((await screen.findAllByText(/1200/)).length > 0);
});
