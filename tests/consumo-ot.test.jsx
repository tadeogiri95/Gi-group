// tests/consumo-ot.test.jsx — 📋 Traer lo que necesita una OT (pedido de
// Tadeo, 27/11; migración 213): se elige la OT y aparecen sus herrajes y
// accesorios (sin placas, fondos ni cantos) con lo que falta; la cantidad y la
// necesidad se pueden cambiar (queda quién y cuándo) y se registra todo junto.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  esHerrajeOAccesorio, necesidadVigente, renglonesConsumoOt, cambiarNecesidad, necesidadCambiada,
  consumoOtParaGuardar, renglonExtra, leerNecesidad,
} from "../app/lib/consumoOt.js";
import { movimientoStockBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/movimientos/route.js");
const { default: ConsumoOt } = await import("../app/components/ConsumoOt.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PLACA = { sku: "1.1.1", nombre: "MELAMINA BLANCA 18 MM", familia: "Placas, chapas, mallas y paneles", division: "Madera", unidad: "UN", activo: true };
const FONDO = { sku: "1.1.2", nombre: "FIBROPLUS BLANCO 3 MM", familia: "Placas, chapas, mallas y paneles", division: "Madera", unidad: "UN", activo: true };
const CANTO = { sku: "1.2.1", nombre: "CANTO PVC BLANCO 22X0,45", familia: "Herrajes y Accesorios", unidad: "MT", activo: true };
const CHAPA = { sku: "1.3.1", nombre: "CHAPA LISA 1,2 MM", familia: "Placas, chapas, mallas y paneles", division: "Metal", unidad: "UN", activo: true };
const BISAGRA = { sku: "4.1.1", nombre: "BISAGRA CAZOLETA 35", familia: "Herrajes y Accesorios", unidad: "UN", activo: true, disponible: 300 };
const CORREDERA = { sku: "4.1.2", nombre: "CORREDERA TELESCOPICA 45", familia: "Herrajes y Accesorios", unidad: "PAR", activo: true };
const COLA = { sku: "5.1.1", nombre: "COLA VINILICA", familia: "Insumos", unidad: "KG", activo: true };
const ARTS = [PLACA, FONDO, CANTO, CHAPA, BISAGRA, CORREDERA, COLA];
const NECESIDADES = [
  { ot: "M-1", sku: "1.1.1", nombre: PLACA.nombre, cantidad: 6 },
  { ot: "M-1", sku: "1.1.2", nombre: FONDO.nombre, cantidad: 2 },
  { ot: "M-1", sku: "1.2.1", nombre: CANTO.nombre, cantidad: 80 },
  { ot: "M-1", sku: "1.3.1", nombre: CHAPA.nombre, cantidad: 1 },
  { ot: "M-1", sku: "4.1.1", nombre: BISAGRA.nombre, cantidad: 20 },
  { ot: "M-1", sku: "4.1.2", nombre: CORREDERA.nombre, cantidad: 4 },
  { ot: "M-1", sku: "5.1.1", nombre: COLA.nombre, cantidad: 1.5 },
];

// ─── Reglas ───

test("lista — todo menos placas, fondos, cantos (y chapas de la familia de las placas)", () => {
  assert.deepEqual(ARTS.filter(esHerrajeOAccesorio).map((a) => a.sku), ["4.1.1", "4.1.2", "5.1.1"]);
  assert.equal(esHerrajeOAccesorio({ nombre: "PERFIL CANTO DE ALUMINIO", familia: "Herrajes y Accesorios" }), true, "el perfil de aluminio no es canto");
});

test("necesidad — vale el último cambio hecho en Gypi; si no, la planilla", () => {
  const v = necesidadVigente(NECESIDADES, [
    { id: 2, sku: "4.1.1", cantidad: 24, created_at: "2026-11-27T15:00:00Z", empleado_nombre: "Ana" },
    { id: 1, sku: "4.1.1", cantidad: 22, created_at: "2026-11-26T15:00:00Z" },
    { id: 3, sku: "9.9.9", nombre: "TIRADOR", cantidad: 3, created_at: "2026-11-27T15:00:00Z" },
  ]);
  assert.equal(v.get("4.1.1").cantidad, 24);
  assert.equal(v.get("4.1.1").mrp, 20);
  assert.equal(v.get("4.1.1").cambio.empleado_nombre, "Ana");
  assert.equal(v.get("4.1.2").cantidad, 4);
  assert.equal(v.get("9.9.9").mrp, null, "agregado en Gypi, no estaba en la planilla");
});

test("renglones — la cantidad arranca en lo que falta; lo completo viene sin marcar", () => {
  const filas = renglonesConsumoOt({
    necesidades: NECESIDADES, articulos: ARTS,
    movimientos: [
      { sku: "4.1.1", tipo: "consumo", cantidad: 12 }, { sku: "4.1.1", tipo: "devolucion", cantidad: 2 },
      { sku: "4.1.2", tipo: "consumo", cantidad: 4 }, { sku: "5.1.1", tipo: "consumo", cantidad: 9, anulado: true },
    ],
  });
  assert.deepEqual(filas.map((f) => [f.sku, f.necesidad, f.retirado, f.cantidad, f.incluir]), [
    ["4.1.1", "20", 10, "10", true],
    ["5.1.1", "1,5", 0, "1,5", true],
    ["4.1.2", "4", 4, "", false],
  ]);
});

test("cambiar la necesidad — recalcula lo que falta si la cantidad no se tocó", () => {
  const [f] = renglonesConsumoOt({ necesidades: NECESIDADES.slice(4, 5), articulos: ARTS, movimientos: [{ sku: "4.1.1", tipo: "consumo", cantidad: 10 }] });
  const g = cambiarNecesidad(f, "24");
  assert.equal(g.cantidad, "14");
  assert.equal(necesidadCambiada(g), true);
  assert.equal(necesidadCambiada(cambiarNecesidad(f, "20")), false);
  const tocada = cambiarNecesidad({ ...f, cantidad: "5", cantidadTocada: true }, "30");
  assert.equal(tocada.cantidad, "5", "lo que escribió el operario no se pisa");
  const cero = cambiarNecesidad(f, "0");
  assert.equal(cero.incluir, false, "necesidad 0: ya no lleva");
  assert.equal(leerNecesidad("0"), 0);
  assert.equal(leerNecesidad("abc"), null);
});

test("guardar — consumos marcados y cambios de necesidad; avisa lo que falta", () => {
  const filas = renglonesConsumoOt({ necesidades: NECESIDADES, articulos: ARTS });
  const editadas = filas.map((f) => (f.sku === "4.1.1" ? cambiarNecesidad(f, "24") : f.sku === "4.1.2" ? { ...f, incluir: false } : f));
  const extra = { ...renglonExtra({ sku: "9.9.9", nombre: "TIRADOR" }), cantidad: "2" };
  const g = consumoOtParaGuardar([...editadas, extra]);
  assert.deepEqual(g.renglones, [{ sku: "4.1.1", cantidad: 24 }, { sku: "5.1.1", cantidad: 1.5 }, { sku: "9.9.9", cantidad: 2 }]);
  assert.deepEqual(g.necesidades, [{ sku: "4.1.1", cantidad: 24 }]);
  assert.match(consumoOtParaGuardar([{ ...extra, cantidad: "" }]).error, /cantidad de TIRADOR/);
  assert.match(consumoOtParaGuardar([{ ...filas[0], necesidad: "x" }]).error, /necesidad de/);
  assert.match(consumoOtParaGuardar(filas.map((f) => ({ ...f, incluir: false }))).error, /Marcá al menos/);
});

test("esquema — consumir_ot con renglones o solo cambios de necesidad", () => {
  assert.equal(movimientoStockBody.safeParse({ accion: "consumir_ot", ot: "M-1", renglones: [{ sku: "4.1.1", cantidad: 2 }] }).success, true);
  assert.equal(movimientoStockBody.safeParse({ accion: "consumir_ot", ot: "M-1", necesidades: [{ sku: "4.1.1", cantidad: 0 }] }).success, true);
  assert.equal(movimientoStockBody.safeParse({ accion: "consumir_ot", ot: "M-1" }).success, false);
  assert.equal(movimientoStockBody.safeParse({ accion: "consumir_ot", ot: "M-1", necesidades: [{ sku: "4.1.1", cantidad: -1 }] }).success, false);
});

test("migración 213 — tabla de cambios con RLS, en un solo bloque", () => {
  const sql = readFileSync(new URL("../supabase/migrations/213_cambios_necesidad.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.necesidades_cambios/);
  assert.match(sql, /necesidades_cambios enable row level security/);
  assert.match(sql, /revoke all on public\.necesidades_cambios from anon/);
  assert.match(sql, /empleado_nombre/);
});

// ─── API ───

function mockRuta({ sin213 = false } = {}) {
  const escrito = { movimientos: [], cambios: [] };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/articulos_stock"), respond: () => ({ status: 200, body: ARTS }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [{ ot: "M-1" }] }) },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ nombre: "Ana" }] }) },
    { match: (u) => u.includes("/rest/v1/necesidades_stock"), respond: () => ({ status: 200, body: [{ sku: "4.1.1", cantidad: 20 }] }) },
    {
      match: (u) => u.includes("/rest/v1/necesidades_cambios"),
      respond: (u, o) => {
        if (sin213) return { status: 404, body: { code: "42P01", message: 'relation "public.necesidades_cambios" does not exist' } };
        if (!o.method || o.method === "GET") return { status: 200, body: [] };
        const body = JSON.parse(o.body);
        escrito.cambios.push(body);
        return { status: 201, body };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/movimientos_stock"),
      respond: (u, o) => {
        if (!o.method || o.method === "GET") return { status: 200, body: [] };
        const body = JSON.parse(o.body);
        escrito.movimientos.push(body);
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

test("/api/stock/movimientos consumir_ot — el operario consume en tanda y cambia una necesidad (queda quién)", async () => {
  const escrito = mockRuta();
  const res = await api.POST(req(await token("empleado"), {
    accion: "consumir_ot", ot: "M-1", fecha: "2026-11-27", motivo: "el cliente pidió más puertas",
    renglones: [{ sku: "4.1.1", cantidad: 24 }, { sku: "5.1.1", cantidad: 1.5 }],
    necesidades: [{ sku: "4.1.1", cantidad: 24 }, { sku: "4.1.2", cantidad: 0 }],
  }));
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.cargados, 2);
  assert.equal(data.necesidades, 2);
  assert.deepEqual(escrito.cambios[0].map((c) => [c.ot, c.sku, c.cantidad_antes, c.cantidad, c.motivo, c.empleado_nombre, c.empleado_id]), [
    ["M-1", "4.1.1", 20, 24, "el cliente pidió más puertas", "Ana", EMP],
    ["M-1", "4.1.2", null, 0, "el cliente pidió más puertas", "Ana", EMP],
  ]);
  assert.deepEqual(escrito.movimientos[0].map((m) => [m.tipo, m.sku, m.cantidad, m.ot, m.fecha, m.empleado_nombre]), [
    ["consumo", "4.1.1", 24, "M-1", "2026-11-27", "Ana"],
    ["consumo", "5.1.1", 1.5, "M-1", "2026-11-27", "Ana"],
  ]);
});

test("/api/stock/movimientos consumir_ot — sin la 213 no cambia la necesidad ni carga nada", async () => {
  const escrito = mockRuta({ sin213: true });
  const res = await api.POST(req(await token("empleado"), {
    accion: "consumir_ot", ot: "M-1", renglones: [{ sku: "4.1.1", cantidad: 2 }], necesidades: [{ sku: "4.1.1", cantidad: 24 }],
  }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 213/);
  assert.equal(escrito.movimientos.length, 0);
  const ok = await api.POST(req(await token("empleado"), { accion: "consumir_ot", ot: "M-1", renglones: [{ sku: "4.1.1", cantidad: 2 }] }));
  assert.equal(ok.status, 200, "sin cambiar la necesidad, consume igual");
  assert.equal(escrito.movimientos.length, 1);
});

// ─── Pantalla ───

test("pantalla — trae los herrajes de la OT, se cambia una necesidad y se registra todo junto", async () => {
  const enviados = [];
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("/api/stock/movimientos")) {
      const body = JSON.parse(opts.body);
      enviados.push(body);
      return new Response(JSON.stringify({ ok: true, cargados: body.renglones.length, necesidades: body.necesidades.length }), { status: 200 });
    }
    const ruta = String(JSON.parse(opts.body || "{}").path || "");
    const filas = ruta.includes("necesidades_stock") ? NECESIDADES
      : ruta.includes("necesidades_cambios") ? [{ id: 1, sku: "4.1.2", cantidad: 6, empleado_nombre: "Beto", created_at: "2026-11-26T12:00:00Z" }]
        : ruta.includes("movimientos_stock") ? [{ sku: "4.1.1", tipo: "consumo", cantidad: 5 }]
          : ruta.includes("articulos_stock") ? ARTS : [];
    return new Response(JSON.stringify({ data: filas }), { status: 200 });
  };
  render(<ConsumoOt empresaId={E} usuario={{ id: EMP, rol: "empleado", nombre: "Ana" }} otInicial="M-1" onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByLabelText(`Cantidad de ${BISAGRA.nombre}`)));
  assert.equal(screen.queryByText(PLACA.nombre), null, "las placas no van");
  assert.equal(screen.queryByText(CANTO.nombre), null, "el canto no va");
  assert.equal(screen.getByLabelText(`Cantidad de ${BISAGRA.nombre}`).value, "15");
  assert.equal(screen.getByLabelText(`Necesidad de ${CORREDERA.nombre}`).value, "6");
  assert.match(screen.getByText(/Necesidad cambiada por Beto/).textContent, /la planilla dice 4/);

  fireEvent.change(screen.getByLabelText(`Necesidad de ${BISAGRA.nombre}`), { target: { value: "25" } });
  assert.equal(screen.getByLabelText(`Cantidad de ${BISAGRA.nombre}`).value, "20");
  fireEvent.change(screen.getByLabelText("Motivo del cambio de necesidad (opcional)"), { target: { value: "puertas extra" } });
  fireEvent.click(screen.getByLabelText(`Consumir ${COLA.nombre}`));
  fireEvent.click(screen.getByText("Registrar consumo de 2 artículos"));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.equal(enviados[0].accion, "consumir_ot");
  assert.equal(enviados[0].ot, "M-1");
  assert.equal(enviados[0].motivo, "puertas extra");
  assert.deepEqual(enviados[0].renglones.map((r) => [r.sku, r.cantidad]), [["4.1.1", 20], ["4.1.2", 6]]);
  assert.deepEqual(enviados[0].necesidades, [{ sku: "4.1.1", cantidad: 25 }]);
  await waitFor(() => assert.match(screen.getByRole("status").textContent, /Se registraron 2 consumos/));
});
