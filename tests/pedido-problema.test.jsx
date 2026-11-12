// tests/pedido-problema.test.jsx — De un problema a un pedido de compra
// (auditoría del 12/11, parte 8; migración 185): un pendiente de obra, una
// falla de máquina o un arreglo de vehículo pide su material desde ahí mismo.
import "./helpers/domSetup.js";
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { notaDelProblema, pedidosPorProblema, textoPedidosProblema } from "../app/lib/pedidoProblema.js";
import { comprasBody } from "../app/lib/schemas.ts";
import { _limpiarCacheAlcance } from "../app/lib/alcance.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
beforeEach(() => _limpiarCacheAlcance());
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/compras/route.js");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { default: PedirParaProblema } = await import("../app/components/PedirParaProblema.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

test("reglas — la nota dice para qué es; el resumen sin anulados", () => {
  assert.equal(notaDelProblema("falla_maquina", "SEC-01 ·  correa  cortada"), "Falla de máquina: SEC-01 · correa cortada");
  assert.equal(textoPedidosProblema([{ descripcion: "Correa", estado: "pendiente" }, { descripcion: "Aceite", estado: "anulado" }, { descripcion: "Filtro", estado: "recibido" }]),
    "🛒 2 pedidos: Correa (por comprar), Filtro (recibido)");
  assert.equal(textoPedidosProblema([{ descripcion: "X", estado: "anulado" }]), "");
  assert.deepEqual([...pedidosPorProblema([{ origen: "falla_maquina", origen_id: 3, id: 1 }, { id: 2 }]).keys()], ["falla_maquina:3"]);
  const ok = (b) => comprasBody.safeParse(b).success;
  assert.equal(ok({ accion: "pedido_crear", descripcion: "Correa", cantidad: 1, origen: "falla_maquina", origen_id: 3 }), true);
  assert.equal(ok({ accion: "pedido_crear", descripcion: "Correa", cantidad: 1, origen: "falla_maquina" }), false, "sin id");
  assert.equal(ok({ accion: "pedido_crear", descripcion: "Correa", cantidad: 1, origen: "otro", origen_id: 3 }), false);
});

function mockRuta({ problema = { id: 5, ot: "M-7495" }, sin185 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: EMP, legajo: 7, nombre: "Ana Jefa", division: "MUEBLES" }] }) },
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ ot: "M-7495" }] }) },
    { match: (u) => /\/rest\/v1\/(pendientes_obra|maquina_fallas|vehiculo_arreglos)/.test(u), respond: (u) => { escrito.push({ tabla: "leido", url: u }); return { status: 200, body: problema ? [problema] : [] }; } },
    {
      match: (u) => u.includes("/rest/v1/pedidos_compra"),
      respond: (u, o) => {
        if (sin185) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'origen' column of 'pedidos_compra' in the schema cache" } };
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "pedidos_compra", body });
        return { status: 201, body: [{ id: 9, ...body }] };
      },
    },
  ]);
  return escrito;
}
const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/compras", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("/api/compras — el pedido del pendiente de obra lleva su OT y de dónde salió", async () => {
  let escrito = mockRuta();
  let res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", descripcion: "Bisagra", cantidad: 4, origen: "pendiente_obra", origen_id: 5, notas: "Pendiente de obra: falta bisagra" }));
  assert.equal(res.status, 200);
  assert.match(escrito[0].url, /pendientes_obra\?id=eq\.5&empresa_id=eq\./);
  const p = escrito.find((x) => x.tabla === "pedidos_compra").body;
  assert.deepEqual([p.origen, p.origen_id, p.ot, p.estado], ["pendiente_obra", 5, "M-7495", "pendiente"]);

  escrito = mockRuta({ problema: null });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", descripcion: "Correa", cantidad: 1, origen: "falla_maquina", origen_id: 99 }));
  assert.equal(res.status, 404, "un problema de otra empresa o que no existe");
  assert.equal(escrito.filter((x) => x.tabla === "pedidos_compra").length, 0);

  mockRuta({ problema: { id: 3 }, sin185: true });
  res = await api.POST(req(await token("gerencial"), { accion: "pedido_crear", descripcion: "Correa", cantidad: 1, origen: "falla_maquina", origen_id: 3 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 185/);
});

function mockPantalla({ pedidos = [] } = {}) {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/compras")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, pedido: { id: 9, descripcion: body.descripcion || "Correa trapezoidal A-42", estado: "pendiente" } }), { status: 200 });
    }
    if (body?.path?.startsWith("pedidos_compra")) return new Response(JSON.stringify({ data: pedidos }), { status: 200 });
    if (body?.path?.startsWith("articulos_stock")) return new Response(JSON.stringify({ data: [{ sku: "9.1.1", nombre: "Correa trapezoidal A-42", unidad: "UN" }] }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return { enviados };
}
const conRol = (rol, ui) => render(<AuthContext.Provider value={{ usuario: { rol } }}>{ui}</AuthContext.Provider>);

test("🛒 Pedir material — elige del stock, pone cantidad y muestra en qué está", async () => {
  const { enviados } = mockPantalla({ pedidos: [{ id: 1, descripcion: "Aceite", estado: "en_oc" }] });
  conRol("administrativo", <PedirParaProblema origen="falla_maquina" origenId={3} texto="SEC-01 · Correa cortada" />);
  assert.ok(await screen.findByText("🛒 1 pedido: Aceite (en orden de compra)"));
  fireEvent.click(screen.getByText("🛒 Pedir material"));
  fireEvent.change(screen.getByLabelText("Artículo del stock o qué hace falta"), { target: { value: "correa" } });
  fireEvent.click(await screen.findByText(/Correa trapezoidal A-42/));
  fireEvent.change(screen.getByLabelText("Cantidad (UN)"), { target: { value: "2" } });
  assert.ok(screen.getByText(/Falla de máquina: SEC-01 · Correa cortada/));
  fireEvent.click(screen.getByText("Pedir"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], {
    accion: "pedido_crear", sku: "9.1.1", descripcion: null, cantidad: 2, ot: null,
    notas: "Falla de máquina: SEC-01 · Correa cortada", origen: "falla_maquina", origen_id: 3,
  });
  assert.ok(await screen.findByText(/🛒 2 pedidos: Aceite \(en orden de compra\), Correa trapezoidal A-42 \(por comprar\)/));
});

test("🛒 Pedir material — el operario no lo ve; sin artículo ni cantidad avisa", async () => {
  mockPantalla();
  conRol("operativo", <PedirParaProblema origen="arreglo_vehiculo" origenId={1} texto="Espejo" />);
  assert.equal(screen.queryByText("🛒 Pedir material"), null);
  cleanup();
  const { enviados } = mockPantalla();
  conRol("gerencial", <PedirParaProblema origen="pendiente_obra" origenId={1} texto="Falta zócalo" ot="M-7495" />);
  fireEvent.click(screen.getByText("🛒 Pedir material"));
  assert.ok(screen.getByText("🛒 Pedir material para la OT M-7495"));
  fireEvent.click(screen.getByText("Pedir"));
  assert.ok(screen.getByText("Elegí el artículo o escribí qué hace falta"));
  fireEvent.change(screen.getByLabelText("Artículo del stock o qué hace falta"), { target: { value: "Zócalo EPS" } });
  fireEvent.click(screen.getByText("Pedir"));
  assert.ok(screen.getByText("Poné la cantidad"));
  assert.equal(enviados.length, 0);
});

test("pantallas — el botón está en la falla, el arreglo y el pendiente de obra; migración 185", () => {
  const fuente = (r) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  assert.match(fuente("app/components/FallasMaquina.jsx"), /<PedirParaProblema origen="falla_maquina"/);
  assert.match(fuente("app/components/ArreglosVehiculo.jsx"), /<PedirParaProblema origen="arreglo_vehiculo"/);
  assert.match(fuente("app/components/ActaOt.jsx"), /<PedirParaProblema origen="pendiente_obra"/);
  const sql = fuente("supabase/migrations/185_pedido_origen.sql");
  assert.match(sql, /add column if not exists origen text/);
  assert.match(sql, /add column if not exists origen_id bigint/);
  assert.match(sql, /pedidos_compra_origen_check/);
});
