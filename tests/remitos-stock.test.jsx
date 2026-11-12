// tests/remitos-stock.test.jsx — Ingreso al stock por foto del remito, para
// revisar (parte 7 del plan Finanzas e Inventario, 11/11; migración 182).
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  borradorRemito, faltaParaConfirmar, ingresosDeRemito, marcaRemito, ordenParaRecibir, validarRemito,
} from "../app/lib/remitosStock.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const ruta = await import("../app/api/stock/remitos/route.js");
const { default: RemitosFoto, aEditor, cuerpoRemito } = await import("../app/components/RemitosFoto.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const OTRO = "33333333-3333-3333-3333-333333333333";
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/0b8c6f3e-1a2b-4c5d-8e9f-0a1b2c3d4e5f.jpg`;
const ARTICULOS = [
  { sku: "1.10", nombre: "MELAMINA BLANCA 18MM", unidad: "UN", division: "PLACAS" },
  { sku: "4.20", nombre: "TORNILLO 4X50", unidad: "CAJA", division: "HERRAJES" },
];

// ─── Reglas ───

test("borrador — reconoce el artículo de cada renglón y limpia lo que leyó la IA", () => {
  const b = borradorRemito({
    proveedor: "  FAPLAC  S.A. ", numero: "0001-00004567", fecha: "2026-11-10",
    renglones: [
      { descripcion: "Melamina blanca 18mm", codigo: "", cantidad: 10 },
      { descripcion: "Placa rara", codigo: "4.20", cantidad: 2.5 },
      { descripcion: "", codigo: "", cantidad: 1 },
      { descripcion: "Algo que no está", codigo: "", cantidad: 0 },
    ],
  }, { articulos: ARTICULOS });
  assert.equal(b.proveedor, "FAPLAC S.A.");
  assert.deepEqual(b.renglones.map((r) => [r.sku, r.como, r.cantidad]), [["1.10", "nombre", 10], ["4.20", "sku", 2.5], [null, null, ""]]);
  assert.equal(borradorRemito({ fecha: "10/11/2026" }).fecha, "", "una fecha que no es AAAA-MM-DD queda vacía");
});

test("validar y confirmar — cantidades con coma, renglones sin artículo y los ingresos marcados", () => {
  const { remito, errores } = validarRemito({ proveedor: "Faplac", numero: "0001-1", renglones: [{ descripcion: "Melamina", cantidad: "1.234,5", sku: "1.10" }, { descripcion: "Flete", cantidad: "1" }] }, { skus: new Set(["1.10"]) });
  assert.deepEqual(errores, []);
  assert.equal(remito.renglones[0].cantidad, 1234.5);
  assert.match(faltaParaConfirmar(remito), /Elegí el artículo de 1 renglón/);
  assert.match(validarRemito({ renglones: [{ descripcion: "x", cantidad: "", sku: "9.99" }] }, { skus: new Set() }).errores.join(" | "), /poné la cantidad.*no está en el stock/);
  assert.match(validarRemito({}).errores[0], /no tiene renglones/);
  assert.equal(faltaParaConfirmar({ proveedor: null, renglones: [] }), "Falta el proveedor");
  const filas = ingresosDeRemito({ id: 5, empresa_id: E, proveedor: "Faplac", numero: "0001-1", renglones: [remito.renglones[0]] }, ARTICULOS, { empleado_id: EMP, legajo: 7, empleado_nombre: "Ana" });
  assert.deepEqual(filas.map((f) => [f.tipo, f.sku, f.nombre, f.cantidad, f.precio_unitario, f.comprobante, f.notas]), [["ingreso", "1.10", "MELAMINA BLANCA 18MM", 1234.5, null, "0001-1", "Remito por foto N° 5"]]);
  assert.equal(marcaRemito("5"), "Remito por foto N° 5");
});

test("orden para recibir — la del mismo proveedor que trae más de esos artículos", () => {
  const ordenes = [{ id: 1, numero: 39, proveedor_nombre: "OTRO SRL" }, { id: 2, numero: 40, proveedor_nombre: "Faplac S.A." }, { id: 3, numero: 41, proveedor_nombre: "FAPLAC" }];
  const items = [{ orden_id: 1, sku: "1.10" }, { orden_id: 2, sku: "1.10" }, { orden_id: 3, sku: "1.10" }, { orden_id: 3, sku: "4.20" }];
  const oc = ordenParaRecibir({ proveedor: "FAPLAC SA", renglones: [{ sku: "1.10" }, { sku: "4.20" }] }, ordenes, items);
  assert.deepEqual(oc, { id: 3, numero: 41, proveedor: "FAPLAC" });
  assert.equal(ordenParaRecibir({ proveedor: "FAPLAC", renglones: [{ sku: "9.99" }] }, ordenes, items), null, "sin artículos en común no es esa orden");
});

// ─── Servidor ───

async function token(rol, empleadoId = EMP) {
  return (await signAccessToken({ empleadoId, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, body, empleadoId) => ruta.POST(new Request("http://localhost/api/stock/remitos", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol, empleadoId)}` }, body: JSON.stringify(body),
}));
const listar = async (rol) => ruta.GET(new Request("http://localhost/api/stock/remitos", { headers: { Authorization: `Bearer ${await token(rol)}` } }));

const PENDIENTE = {
  id: 5, origen: "remito", proveedor: "FAPLAC", numero: "0001-00004567", fecha: "2026-11-10", foto_url: FOTO, notas: null, estado: "para_revisar",
  renglones: [{ descripcion: "Melamina blanca 18mm", codigo: null, cantidad: 10, sku: "1.10" }, { descripcion: "Tornillos", codigo: null, cantidad: 2, sku: null }],
  cargado_por: OTRO, cargado_por_nombre: "Juan", created_at: "2026-11-11T10:00:00Z",
};

function mockApi({ remito = PENDIENTE, repetido = null, ordenes = [], items = [], anthropic = null, sinTabla = false } = {}) {
  const escrito = [];
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: ARTICULOS }) },
    { match: (u) => u.includes("/rest/v1/asociaciones_articulos"), respond: (u, o) => { if (o?.method === "POST") escrito.push({ tabla: "asociaciones_articulos", body: JSON.parse(o.body) }); return { status: o?.method === "POST" ? 201 : 200, body: o?.method === "POST" ? "" : [] }; } },
    { match: (u) => u.includes("/rest/v1/ordenes_compra_items"), respond: () => ({ status: 200, body: items }) },
    { match: (u) => u.includes("/rest/v1/ordenes_compra?"), respond: () => ({ status: 200, body: ordenes }) },
    { match: (u) => u === FOTO, respond: () => ({ status: 200, body: "foto" }) },
    { match: (u) => u.includes("api.anthropic.com"), respond: () => anthropic },
    {
      match: (u) => u.includes("/rest/v1/remitos_stock"),
      respond: (u, o) => {
        if (sinTabla) return { status: 404, body: { code: "42P01", message: 'relation "public.remitos_stock" does not exist' } };
        const metodo = o?.method || "GET";
        if (metodo === "GET") { leido.push(decodeURIComponent(u)); return { status: 200, body: remito ? [remito] : [] }; }
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "remitos_stock", metodo, url: decodeURIComponent(u), body });
        return { status: metodo === "POST" ? 201 : 200, body: [{ ...remito, ...body, id: remito?.id || 9 }] };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if ((o?.method || "GET") === "GET") return { status: 200, body: repetido ? [repetido] : [] };
        const body = JSON.parse(o.body);
        escrito.push({ tabla: "movimientos_stock", metodo: o.method, body });
        return { status: 201, body };
      },
    },
  ]);
  return { escrito, leido };
}

test("/api/stock/remitos leer — la IA lee la foto, reconoce artículos y avisa de la orden abierta", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const lectura = { proveedor: "FAPLAC", numero: "0001-00004567", fecha: "2026-11-10", renglones: [{ descripcion: "MELAMINA BLANCA 18MM", codigo: "", cantidad: 10 }, { descripcion: "Fleje", codigo: "", cantidad: 1 }] };
  const { escrito } = mockApi({
    ordenes: [{ id: 3, numero: 41, proveedor_nombre: "Faplac" }], items: [{ orden_id: 3, sku: "1.10" }],
    anthropic: { status: 200, body: { model: "m", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify(lectura) }] } },
  });
  const r = await pedir("operativo", { accion: "leer", foto_url: FOTO });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.deepEqual(d.borrador.renglones.map((x) => x.sku), ["1.10", null]);
  assert.equal(d.borrador.foto_url, FOTO);
  assert.deepEqual(d.orden, { id: 3, numero: 41, proveedor: "Faplac" });
  assert.match(d.avisos[0], /orden de compra N° 41 de Faplac.*Compras → 📦 Recibir/);
  assert.equal(escrito.length, 0, "leer no guarda nada");
  assert.equal((await pedir("operativo", { accion: "leer", foto_url: "https://otro.com/x.jpg" })).status, 400, "solo fotos subidas a Gypi de la empresa");
});

test("/api/stock/remitos guardar — cualquiera lo manda a revisar; confirmar en el momento solo la oficina", async () => {
  const cuerpo = { accion: "guardar", proveedor: "FAPLAC", numero: "0001-2", foto_url: FOTO, renglones: [{ descripcion: "Melamina", cantidad: "10", sku: "1.10" }, { descripcion: "Algo", cantidad: "1" }] };
  let { escrito } = mockApi({ remito: null });
  let r = await pedir("operativo", cuerpo);
  let d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.estado, "para_revisar");
  const alta = escrito.find((x) => x.tabla === "remitos_stock");
  assert.deepEqual([alta.body.estado, alta.body.empresa_id, alta.body.cargado_por, alta.body.renglones.length], ["para_revisar", E, EMP, 2]);
  assert.equal(escrito.filter((x) => x.tabla === "movimientos_stock").length, 0, "todavía no entra al stock");

  mockApi({ remito: null });
  assert.equal((await pedir("operativo", { ...cuerpo, confirmar: true })).status, 403);

  ({ escrito } = mockApi({ remito: null }));
  r = await pedir("administrativo", { ...cuerpo, confirmar: true });
  assert.equal(r.status, 400, "con un renglón sin artículo no se confirma");
  assert.match((await r.json()).error, /Elegí el artículo de 1 renglón/);

  ({ escrito } = mockApi({ remito: null }));
  r = await pedir("administrativo", { ...cuerpo, renglones: [cuerpo.renglones[0]], confirmar: true });
  d = await r.json();
  assert.deepEqual([r.status, d.estado, d.cargados], [200, "confirmado", 1]);
  assert.equal(escrito.find((x) => x.tabla === "movimientos_stock").body[0].notas, "Remito por foto N° 9");
});

test("/api/stock/remitos confirmar — la oficina corrige, confirma y queda recordado para el proveedor", async () => {
  const { escrito } = mockApi();
  const renglones = [PENDIENTE.renglones[0], { ...PENDIENTE.renglones[1], sku: "4.20" }];
  const r = await pedir("gerencial", { accion: "confirmar", id: 5, renglones });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.cargados, 2);
  const patch = escrito.find((x) => x.tabla === "remitos_stock");
  assert.equal(patch.metodo, "PATCH");
  assert.match(patch.url, /estado=eq\.para_revisar/, "solo uno que sigue para revisar (no se confirma dos veces)");
  assert.equal(patch.body.estado, "confirmado");
  const ingresos = escrito.find((x) => x.tabla === "movimientos_stock").body;
  assert.deepEqual(ingresos.map((f) => [f.sku, f.cantidad, f.proveedor, f.comprobante]), [["1.10", 10, "FAPLAC", "0001-00004567"], ["4.20", 2, "FAPLAC", "0001-00004567"]]);
  const memoria = escrito.find((x) => x.tabla === "asociaciones_articulos").body;
  assert.ok(memoria.some((m) => m.tipo === "texto" && m.sku === "4.20"), "el próximo remito de FAPLAC reconoce los tornillos solo");
  assert.equal((await pedir("operativo", { accion: "confirmar", id: 5 })).status, 403);
});

test("/api/stock/remitos — un comprobante que ya entró avisa; con forzar entra igual", async () => {
  const renglones = [PENDIENTE.renglones[0]];
  let { escrito } = mockApi({ repetido: { comprobante: "0001-00004567", proveedor: "FAPLAC", notas: "OC N° 40", created_at: "2026-11-09T12:00:00Z" } });
  let r = await pedir("gerencial", { accion: "confirmar", id: 5, renglones });
  const d = await r.json();
  assert.deepEqual([r.status, d.repetido], [409, true]);
  assert.match(d.error, /OC N° 40/);
  assert.equal(escrito.length, 0);
  ({ escrito } = mockApi({ repetido: { comprobante: "0001-00004567", proveedor: "FAPLAC", notas: "OC N° 40" } }));
  r = await pedir("gerencial", { accion: "confirmar", id: 5, renglones, forzar: true });
  assert.equal(r.status, 200);
  assert.equal(escrito.filter((x) => x.tabla === "movimientos_stock").length, 1);
});

test("/api/stock/remitos descartar y listar — cada uno lo suyo; sin la migración avisa", async () => {
  mockApi();
  assert.equal((await pedir("operativo", { accion: "descartar", id: 5 })).status, 403, "no es suyo");
  let { escrito } = mockApi();
  assert.equal((await pedir("operativo", { accion: "descartar", id: 5 }, OTRO)).status, 200, "quien lo cargó lo puede descartar");
  assert.equal(escrito[0].body.estado, "descartado");
  ({ escrito } = mockApi({ remito: { ...PENDIENTE, estado: "confirmado" } }));
  assert.equal((await pedir("gerencial", { accion: "descartar", id: 5 })).status, 409, "uno ya confirmado no se descarta");

  const { leido } = mockApi();
  let d = await (await listar("operativo")).json();
  assert.equal(d.puede_confirmar, false);
  assert.ok(leido.every((u) => u.includes(`cargado_por=eq.${EMP}`)), "el operario ve solo los suyos");
  d = await (await listar("administrativo")).json();
  assert.equal(d.puede_confirmar, true);

  mockApi({ sinTabla: true });
  d = await (await listar("gerencial")).json();
  assert.match(d.falta_migracion, /migración 182/);
});

// ─── Pantalla ───

test("pantalla — aEditor y cuerpoRemito van y vuelven sin perder datos", () => {
  const ed = aEditor({ ...PENDIENTE, renglones: [{ descripcion: "Melamina", codigo: "M18", cantidad: 2.5, sku: "1.10" }] });
  assert.equal(ed.renglones[0].cantidad, "2,5");
  assert.deepEqual(cuerpoRemito(ed).renglones, [{ descripcion: "Melamina", codigo: "M18", cantidad: "2,5", sku: "1.10" }]);
});

test("pantalla — la oficina revisa un remito pendiente, elige el artículo que falta y lo confirma", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/stock/remitos")) {
      if (!opts.body) return new Response(JSON.stringify({ ok: true, pendientes: [PENDIENTE], revisados: [], puede_confirmar: true }), { status: 200 });
      const body = JSON.parse(opts.body);
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, id: 5, estado: "confirmado", cargados: 2 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  let ingresos = 0;
  render(<RemitosFoto articulos={ARTICULOS} onIngreso={() => { ingresos += 1; }} />);
  await waitFor(() => screen.getByText("🕓 Remitos para revisar (1)"));
  assert.ok(screen.getByText("📷 Ingreso por foto del remito"));
  fireEvent.click(screen.getByText("Revisar"));
  assert.equal(screen.getByLabelText("Proveedor").value, "FAPLAC");
  assert.ok(screen.getByText(/Para confirmarlo, cada renglón tiene que tener su artículo \(falta 1\)/));
  fireEvent.change(screen.getByLabelText("Buscar el artículo de Tornillos"), { target: { value: "tornillo" } });
  fireEvent.click(screen.getByText("TORNILLO 4X50"));
  fireEvent.change(screen.getByLabelText("Cantidad de Tornillos"), { target: { value: "3" } });
  fireEvent.click(screen.getByText("✅ Confirmar ingreso"));
  await waitFor(() => screen.getByText("✅ Entró al stock: 2 artículos."));
  assert.equal(enviados[0].accion, "confirmar");
  assert.equal(enviados[0].id, 5);
  assert.deepEqual(enviados[0].renglones.map((r) => [r.sku, r.cantidad]), [["1.10", "10"], ["4.20", "3"]]);
  assert.equal(ingresos, 1, "los movimientos se recargan");
});

test("pantalla — quien no es de la oficina solo lo manda a revisar", async () => {
  global.fetch = async () => new Response(JSON.stringify({ ok: true, pendientes: [{ ...PENDIENTE, cargado_por: EMP }], revisados: [], puede_confirmar: false }), { status: 200 });
  render(<RemitosFoto articulos={ARTICULOS} />);
  await waitFor(() => screen.getByText("🕓 Remitos para revisar (1)"));
  fireEvent.click(screen.getByText("Ver"));
  assert.equal(screen.queryByText("✅ Confirmar ingreso"), null);
});
