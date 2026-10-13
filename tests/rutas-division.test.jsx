// tests/rutas-division.test.jsx — Órdenes de Producción, parte 2 (ítem 39):
// ruta de etapas por división. El dueño la arma; el operario ve solo esas
// etapas y, al elegir una, solo las OT cuya división pasa por ella.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { normalizar, buscarDivision, rutaDe, etapasParaOperario, otPasaPorEtapa } from "../app/lib/rutas.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: ActividadScreen } = await import("../app/actividad_screen.jsx");
const { default: RutasEditor } = await import("../app/components/RutasEditor.jsx");

const ETAPAS = [
  { codigo: 0, nombre: "Parado", icon: "⏸", color: "#DC2626" },
  { codigo: 1, nombre: "Corte", icon: "✂️", color: "#F00" },
  { codigo: 2, nombre: "Enchapado", icon: "🪵", color: "#0F0" },
  { codigo: 3, nombre: "Armado", icon: "🔧", color: "#00F" },
  { codigo: 4, nombre: "Soldadura", icon: "🔥", color: "#F0F" },
];
const DIVISIONES = [
  { id: "d-m", clave: "MUE", label: "Muebles", icon: "🪑", ruta_etapas: [1, 2, 3] },
  { id: "d-h", clave: "HER", label: "Herrería", icon: "⚙️", ruta_etapas: [1, 4, 3] },
  { id: "d-a", clave: "ALU", label: "Aluminio", icon: "🪟", ruta_etapas: null },
];

// ─── Reglas ───

test("normalizar y buscarDivision — reconoce la división de la planilla por nombre, clave o id", () => {
  assert.equal(normalizar("  HERRERÍA "), "herreria");
  assert.equal(buscarDivision(DIVISIONES, "MUEBLES ").id, "d-m");
  assert.equal(buscarDivision(DIVISIONES, "Herreria").id, "d-h");
  assert.equal(buscarDivision(DIVISIONES, "alu").id, "d-a");
  assert.equal(buscarDivision(DIVISIONES, "d-m").id, "d-m");
  assert.equal(buscarDivision(DIVISIONES, "Pintura"), null);
  assert.equal(buscarDivision(DIVISIONES, ""), null);
});

test("rutaDe — sin repetidos ni basura; sin ruta es una lista vacía", () => {
  assert.deepEqual(rutaDe({ ruta_etapas: [3, 1, 3, "2", 0, null] }), [3, 1, 2]);
  assert.deepEqual(rutaDe({ ruta_etapas: null }), []);
  assert.deepEqual(rutaDe(null), []);
});

test("etapasParaOperario — con ruta, solo esas y en su orden; sin ruta o sin división, todas", () => {
  const nombres = (l) => l.map((e) => e.nombre);
  assert.deepEqual(nombres(etapasParaOperario(ETAPAS, DIVISIONES, "d-h")), ["Corte", "Soldadura", "Armado"]);
  assert.deepEqual(nombres(etapasParaOperario(ETAPAS, DIVISIONES, "d-a")), ["Corte", "Enchapado", "Armado", "Soldadura"]);
  assert.deepEqual(nombres(etapasParaOperario(ETAPAS, DIVISIONES, null)), ["Corte", "Enchapado", "Armado", "Soldadura"]);
  // Una ruta con etapas que ya no existen no deja al operario sin etapas
  assert.equal(etapasParaOperario(ETAPAS, [{ id: "x", ruta_etapas: [99] }], "x").length, 4);
});

test("otPasaPorEtapa — oculta solo las OT con ruta que no incluye la etapa", () => {
  assert.equal(otPasaPorEtapa({ division: "MUEBLES" }, DIVISIONES, 2), true);
  assert.equal(otPasaPorEtapa({ division: "HERRERIA" }, DIVISIONES, 2), false);
  assert.equal(otPasaPorEtapa({ division: "ALUMINIO" }, DIVISIONES, 2), true, "sin ruta: se ve");
  assert.equal(otPasaPorEtapa({ division: "OTRA" }, DIVISIONES, 2), true, "división desconocida: se ve");
  assert.equal(otPasaPorEtapa({}, DIVISIONES, 2), true);
});

// ─── Operario ───

const PROYECTOS = [
  { ot: "M-1", cliente: "Ana", division: "MUEBLES" },
  { ot: "H-2", cliente: "Beto", division: "HERRERIA" },
  { ot: "A-3", cliente: "Caro", division: "ALUMINIO" },
];

async function operario(division) {
  render(
    <ActividadScreen
      tareaActiva={null} historial={[]} etapas={ETAPAS} divisiones={DIVISIONES} proyectos={PROYECTOS}
      loading={false} elapsed={0} usuario={{ id: "emp-rutas", division }} empresa={{}} fichadaHoy={{ ingreso: "08:00:00" }}
      iniciarTarea={async () => {}} finalizarTarea={async () => {}} cambiarTarea={async () => {}}
    />
  );
  fireEvent.click(await screen.findByText(/Iniciar tarea/i));
}

test("operario de Herrería — ve solo las etapas de su ruta, en orden", async () => {
  await operario("d-h");
  const NOMBRES = ["Corte", "Enchapado", "Armado", "Soldadura"];
  const etapas = screen.getAllByRole("button").map((b) => NOMBRES.find((n) => b.textContent.endsWith(n))).filter(Boolean);
  assert.deepEqual(etapas, ["Corte", "Soldadura", "Armado"]);
});

test("al elegir Enchapado — no aparecen las OT de Herrería, sí las de Muebles y las de Aluminio (sin ruta)", async () => {
  await operario(null);
  fireEvent.click(screen.getByText("Enchapado"));
  assert.ok(screen.getByText("M-1"));
  assert.ok(screen.getByText("A-3"));
  assert.equal(screen.queryByText("H-2"), null);
});

test("buscando una OT que no pasa por la etapa — avisa por qué no aparece", async () => {
  await operario(null);
  fireEvent.click(screen.getByText("Enchapado"));
  fireEvent.change(screen.getByPlaceholderText(/Buscar OT/), { target: { value: "Beto" } });
  assert.ok(screen.getByText(/Otra OT coincide, pero su división no pasa por esta etapa/));
});

// ─── Dueño: pantalla de rutas ───

test("pantalla de rutas — agregar, ordenar y guardar la ruta de una división", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => {
    pedidos.push({ url, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ division: { id: "d-a" } }), { status: 200 });
  };
  const guardadas = [];
  render(<RutasEditor divisiones={DIVISIONES} etapas={ETAPAS} onGuardado={(d) => guardadas.push(d)} />);
  fireEvent.click(screen.getByRole("tab", { name: /Aluminio/ }));
  assert.ok(screen.getByText(/Sin ruta: esta división ve todas las etapas/));
  fireEvent.click(screen.getByText("+ ✂️ Corte"));
  fireEvent.click(screen.getByText("+ 🔧 Armado"));
  fireEvent.click(screen.getByText("+ 🪵 Enchapado"));
  fireEvent.click(screen.getByLabelText("Subir Enchapado"));
  const ruta = screen.getByRole("list", { name: "Ruta de Aluminio" });
  assert.deepEqual(within(ruta).getAllByRole("listitem").map((li) => li.textContent.replace(/[↑↓✕]/g, "")), ["1✂️Corte", "2🪵Enchapado", "3🔧Armado"]);
  fireEvent.click(screen.getByText("Guardar ruta"));
  await waitFor(() => assert.equal(guardadas.length, 1));
  assert.equal(pedidos[0].url, "/api/config-empresa");
  assert.deepEqual(pedidos[0].body, { action: "update_division", id: "d-a", ruta_etapas: [1, 2, 3] });
  assert.deepEqual(guardadas[0].ruta_etapas, [1, 2, 3]);
});

test("pantalla de rutas — 'Usar todas' borra la ruta", async () => {
  const pedidos = [];
  global.fetch = async (url, opts) => { pedidos.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); };
  render(<RutasEditor divisiones={DIVISIONES} etapas={ETAPAS} />);
  fireEvent.click(screen.getByText("Usar todas"));
  await waitFor(() => assert.equal(pedidos.length, 1));
  assert.deepEqual(pedidos[0], { action: "update_division", id: "d-m", ruta_etapas: [] });
});

// ─── Servidor ───

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { PATCH } = await import("../app/api/config-empresa/route.js");
const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const DIV_ID = "33333333-3333-3333-3333-333333333333";

async function patchRuta(ruta, respuestaPatch) {
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  let enviado = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/divisiones") && u.includes("select=empresa_id"), respond: () => ({ status: 200, body: [{ empresa_id: EMPRESA_ID }] }) },
    { match: (u, o) => u.includes("/rest/v1/divisiones") && o?.method === "PATCH", respond: (u, o) => { enviado = JSON.parse(o.body); return respuestaPatch(enviado); } },
  ]);
  const res = await PATCH(new Request("http://localhost/api/config-empresa", {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "update_division", id: DIV_ID, ruta_etapas: ruta }),
  }));
  return { res, enviado };
}

test("config-empresa — guarda la ruta sin repetidos; vacía queda como null", async () => {
  const ok = (b) => ({ status: 200, body: [{ id: DIV_ID, ...b }] });
  let r = await patchRuta([3, 1, 3], ok);
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.enviado, { ruta_etapas: [3, 1] });
  r = await patchRuta([], ok);
  assert.deepEqual(r.enviado, { ruta_etapas: null });
});

test("config-empresa — ruta con códigos inválidos se rechaza", async () => {
  const { res } = await patchRuta([0, -1], () => ({ status: 200, body: [] }));
  assert.equal(res.status, 400);
});

test("config-empresa — sin la migración 098 avisa qué falta", async () => {
  const { res } = await patchRuta([1], () => ({ status: 400, body: { code: "PGRST204", message: "Could not find the 'ruta_etapas' column of 'divisiones' in the schema cache" } }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 098/);
});
