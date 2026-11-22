// tests/stock-tanda.test.jsx — Carga por tanda en Materiales → Movimientos
// (22/11, pedido de Tadeo): una fecha y toda la tanda de consumos o de
// ingresos de ese día de una vez, el mismo artículo más de una vez, pegar
// desde Excel y no perder lo cargado si se cierra la app.
import "./helpers/domSetup.js";
import { test, before, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { leerTandaPegada, renglonesParaGuardar, articuloDeTexto, MAX_TANDA } from "../app/lib/tandaMovimientos.js";
import { movimientoStockBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
beforeEach(() => { try { window.localStorage.clear(); } catch { /* nada */ } });
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/movimientos/route.js");
const { default: MovimientosStock } = await import("../app/components/MovimientosStock.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PLACA = { sku: "1.1.1", nombre: "Placa melamina blanca 18", unidad: "UN", activo: true };
const CANTO = { sku: "1.2.1", nombre: "Canto PVC blanco 22", unidad: "MT", activo: true };
const TORNILLO = { sku: "4.4.4", nombre: "Tornillo 4x40", unidad: "UN", activo: true };
const ARTS = [PLACA, CANTO, TORNILLO];

// ─── Reglas ───

test("pegar desde Excel — consumo con OT, títulos salteados, el mismo artículo dos veces", () => {
  const t = "Artículo\tCantidad\tOT\n1.1.1\t3\tM-7495\nPlaca melamina blanca 18\t2\tM-7500\ncanto pvc\t12,5\t\nNo existe\t1\t\nTornillo 4x40\t\t";
  const r = leerTandaPegada(t, ARTS, "consumo");
  assert.deepEqual(r.renglones.map((x) => [x.articulo.sku, x.cantidad, x.ot]), [["1.1.1", "3", "M-7495"], ["1.1.1", "2", "M-7500"], ["1.2.1", "12,5", ""]]);
  assert.deepEqual(r.noEncontrados, ["No existe"]);
  assert.deepEqual(r.sinCantidad, ["Tornillo 4x40"]);
  assert.notEqual(r.renglones[0].id, r.renglones[1].id, "cada renglón con su id");
});

test("pegar desde Excel — ingreso con precio, proveedor y comprobante", () => {
  const r = leerTandaPegada("1.1.1\t10\t25.000,50\tMaderas SA\t0001-123", ARTS, "ingreso");
  assert.deepEqual(r.renglones.map((x) => [x.cantidad, x.precio, x.proveedor, x.comprobante]), [["10", "25.000,50", "Maderas SA", "0001-123"]]);
  const g = renglonesParaGuardar({ tipo: "ingreso", renglones: r.renglones });
  assert.deepEqual(g.renglones, [{ sku: "1.1.1", cantidad: 10, proveedor: "Maderas SA", comprobante: "0001-123", precio_unitario: 25000.5 }]);
});

test("artículo por texto — código, nombre o uno solo parecido", () => {
  assert.equal(articuloDeTexto("4.4.4", ARTS), TORNILLO);
  assert.equal(articuloDeTexto("PLACA MELAMINA BLANCA 18", ARTS), PLACA);
  assert.equal(articuloDeTexto("tornillo", ARTS), TORNILLO);
  assert.equal(articuloDeTexto("blanc", ARTS), null, "dos parecidos: no adivina");
});

test("guardar — avisa la cantidad que falta y el precio que no es número", () => {
  const r = leerTandaPegada("1.1.1\t3", ARTS, "consumo").renglones;
  assert.match(renglonesParaGuardar({ tipo: "consumo", renglones: [...r, { ...r[0], id: "x", cantidad: "" }] }).error, /cantidad de Placa/);
  assert.match(renglonesParaGuardar({ tipo: "ingreso", renglones: [{ ...r[0], precio: "abc" }] }).error, /precio de Placa/);
  assert.equal(renglonesParaGuardar({ tipo: "ingreso", renglones: [{ ...r[0], precio: "0" }] }).renglones[0].precio_unitario, 0);
});

test("esquema — ingresos por tanda, hasta 200", () => {
  const ren = (n) => Array.from({ length: n }, () => ({ sku: "1.1.1", cantidad: 1, proveedor: "X", comprobante: "1", precio_unitario: 2 }));
  assert.equal(movimientoStockBody.safeParse({ accion: "registrar_varios", tipo: "ingreso", renglones: ren(MAX_TANDA) }).success, true);
  assert.equal(movimientoStockBody.safeParse({ accion: "registrar_varios", tipo: "ingreso", renglones: ren(MAX_TANDA + 1) }).success, false);
  assert.equal(movimientoStockBody.safeParse({ accion: "registrar_varios", tipo: "ajuste", renglones: ren(1) }).success, false, "el ajuste sigue de a uno");
});

// ─── API ───

function mockRuta({ repetido = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: ARTS }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [{ id: 4, nombre: "ALUAR S.A.", activo: true }, { id: 5, nombre: "MADERAS SA", activo: true }] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/recepciones_compra"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: repetido ? [{ id: 2, proveedor: "MADERAS SA", comprobante: "0001-123", notas: null, created_at: "2026-11-20T10:00:00Z" }] : [] };
        const body = JSON.parse(o.body);
        escrito.push(body);
        return { status: 201, body: body.map((b, i) => ({ id: i + 1, ...b })) };
      },
    },
  ]);
  return escrito;
}
const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const req = (t, body) => new Request("http://localhost/api/stock/movimientos", {
  method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("/api/stock/movimientos — una tanda de ingresos de varios proveedores, todos con la misma fecha", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("administrativo"), {
    accion: "registrar_varios", tipo: "ingreso", fecha: "2026-11-20",
    renglones: [
      { sku: "1.1.1", cantidad: 10, proveedor: "Maderas S.A.", comprobante: "0001-123", precio_unitario: 25000 },
      { sku: "1.1.1", cantidad: 5, proveedor: "maderas sa", comprobante: "0001-123", precio_unitario: 25000 },
      { sku: "1.2.1", cantidad: 100, proveedor: "Desconocido SRL", comprobante: null, precio_unitario: null },
    ],
  }));
  const data = await res.json();
  assert.equal(res.status, 400, "ese proveedor no está en la lista");
  assert.match(data.error, /Renglón 3/);
  assert.equal(escrito.length, 0);

  const ok = await api.POST(req(await token("administrativo"), {
    accion: "registrar_varios", tipo: "ingreso", fecha: "2026-11-20",
    renglones: [
      { sku: "1.1.1", cantidad: 10, proveedor: "Maderas S.A.", comprobante: "0001-123", precio_unitario: 25000 },
      { sku: "1.1.1", cantidad: 5, proveedor: "maderas sa", comprobante: "0001-123", precio_unitario: 25000 },
      { sku: "1.2.1", cantidad: 100, proveedor: "ALUAR S.A.", ot: "M-1" },
    ],
  }));
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  assert.equal(escrito.length, 1, "un solo guardado con todos");
  assert.deepEqual(escrito[0].map((f) => [f.tipo, f.sku, f.cantidad, f.proveedor, f.proveedor_id, f.comprobante, f.precio_unitario, f.ot, f.fecha]), [
    ["ingreso", "1.1.1", 10, "MADERAS SA", 5, "0001-123", 25000, null, "2026-11-20"],
    ["ingreso", "1.1.1", 5, "MADERAS SA", 5, "0001-123", 25000, null, "2026-11-20"],
    ["ingreso", "1.2.1", 100, "ALUAR S.A.", 4, null, null, null, "2026-11-20"],
  ]);
});

test("/api/stock/movimientos — tanda con un comprobante que ya entró: avisa y se carga solo confirmando", async () => {
  const escrito = mockRuta({ repetido: true });
  const body = { accion: "registrar_varios", tipo: "ingreso", renglones: [{ sku: "1.1.1", cantidad: 1, proveedor: "MADERAS SA", comprobante: "0001-123" }] };
  const res = await api.POST(req(await token("gerencial"), body));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).repetido, true);
  assert.equal(escrito.length, 0);
  const ok = await api.POST(req(await token("gerencial"), { ...body, forzar: true }));
  assert.equal(ok.status, 200);
  assert.equal(escrito.length, 1);
});

// ─── Pantalla ───

function mockPantalla() {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (String(url).includes("/api/stock/movimientos")) {
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, cargados: body.renglones?.length || 1 }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return enviados;
}
const OFICINA = { id: EMP, rol: "administrativo" };

test("pantalla — más de 3 artículos, el mismo dos veces, y un solo Guardar", async () => {
  const enviados = mockPantalla();
  render(<MovimientosStock usuario={OFICINA} articulos={ARTS} />);
  fireEvent.click(screen.getByText("📤 Cargar consumo"));
  fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-20" } });
  for (const [texto, nombre] of [["placa", PLACA.nombre], ["placa", PLACA.nombre], ["canto", CANTO.nombre], ["tornillo", TORNILLO.nombre]]) {
    fireEvent.change(document.getElementById("mov-articulo"), { target: { value: texto } });
    fireEvent.click(screen.getByText(nombre, { selector: "b" }));
  }
  const cantidades = screen.getAllByLabelText(/^Cantidad de/);
  assert.equal(cantidades.length, 4);
  ["2", "1", "15", "40"].forEach((v, i) => fireEvent.change(cantidades[i], { target: { value: v } }));
  const ots = screen.getAllByLabelText(/^OT de/);
  fireEvent.change(ots[0], { target: { value: "M-7495" } });
  fireEvent.change(ots[1], { target: { value: "M-7500" } });
  fireEvent.click(screen.getByText("Guardar los 4"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].fecha, "2026-11-20");
  assert.deepEqual(enviados[0].renglones.map((r) => [r.sku, r.cantidad, r.ot]), [["1.1.1", 2, "M-7495"], ["1.1.1", 1, "M-7500"], ["1.2.1", 15, null], ["4.4.4", 40, null]]);
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /Se cargaron 4 consumos del 20\/11/));
});

test("pantalla — ingreso: el renglón nuevo copia proveedor y comprobante, y se pega desde Excel", async () => {
  const enviados = mockPantalla();
  render(<MovimientosStock usuario={OFICINA} articulos={ARTS} />);
  fireEvent.click(screen.getByText("📥 Cargar ingreso"));
  fireEvent.change(screen.getByLabelText("Proveedor para todos"), { target: { value: "MADERAS SA" } });
  fireEvent.change(screen.getByLabelText("N° de comprobante"), { target: { value: "0001-9" } });
  fireEvent.change(document.getElementById("mov-articulo"), { target: { value: "placa" } });
  fireEvent.click(screen.getByText(PLACA.nombre, { selector: "b" }));
  fireEvent.click(screen.getByText("📋 Pegar desde Excel o la planilla"));
  fireEvent.change(screen.getByLabelText("Pegá las filas copiadas de Excel"), { target: { value: "1.2.1\t50\t1200\n4.4.4\t500\t\tOTRO SA\t77" } });
  fireEvent.click(screen.getByText("Agregar renglones"));
  assert.match(screen.getByText(/Se agregaron 2 renglones/).textContent, /2/);
  fireEvent.change(screen.getByLabelText(`Cantidad de ${PLACA.nombre}`), { target: { value: "8" } });
  fireEvent.click(screen.getByText("Guardar los 3"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0].renglones.map((r) => [r.sku, r.cantidad, r.precio_unitario, r.proveedor, r.comprobante]), [
    ["1.1.1", 8, null, "MADERAS SA", "0001-9"],
    ["1.2.1", 50, 1200, "MADERAS SA", "0001-9"],
    ["4.4.4", 500, null, "OTRO SA", "77"],
  ]);
});

test("pantalla — lo cargado queda guardado si se cierra y se recupera al volver", () => {
  mockPantalla();
  const { unmount } = render(<MovimientosStock usuario={OFICINA} articulos={ARTS} />);
  fireEvent.click(screen.getByText("📤 Cargar consumo"));
  fireEvent.change(document.getElementById("mov-articulo"), { target: { value: "canto" } });
  fireEvent.click(screen.getByText(CANTO.nombre, { selector: "b" }));
  unmount();
  render(<MovimientosStock usuario={OFICINA} articulos={ARTS} tipoInicial="consumo" />);
  assert.ok(screen.getByText(/Recuperé los 1 renglones/));
  assert.ok(screen.getByLabelText(`Cantidad de ${CANTO.nombre}`));
});
