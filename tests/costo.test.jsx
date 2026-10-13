// tests/costo.test.jsx — Órdenes de Producción, parte 8 (ítem 39): costo de
// la hora de mano de obra (solo el dueño) y costo de cada OT, separado en
// fábrica, paradas e instalación.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { costoOp, costoDe, esEtapaDeInstalacion, fmtPesos } from "../app/lib/costo.js";
import { calcularIndicadores } from "../app/lib/indicadores.js";
import { costoHoraBody } from "../app/lib/schemas.ts";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { default: DetalleOp } = await import("../app/components/DetalleOp.jsx");
const { default: Indicadores } = await import("../app/components/Indicadores.jsx");
const { default: CostoEditor, leerPesos } = await import("../app/components/CostoEditor.jsx");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/costo-hora/route.js");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

const ETAPAS = [
  { codigo: 0, nombre: "Parado" },
  { codigo: 1, nombre: "Corte", orden: 1 },
  { codigo: 5, nombre: "Armado", orden: 5 },
  { codigo: 12, nombre: "Instalación", orden: 12 },
];
const fin = "2026-10-13T12:00:00Z";
const t = (etapa, min, extra = {}) => ({ etapa, duracion_min: min, hora_fin: fin, fecha: "2026-10-13", legajo: 7, codigo_proyecto: "7495", ...extra });
const TAREAS = [
  t(1, 120),
  t(5, 240),
  t(12, 180),
  t(0, 60, { causa: "SM" }),
];

// ─── Cálculo ───

test("costo — fábrica, paradas e instalación por separado", () => {
  const c = costoOp({ etapas: [{ nombre: "Corte", min: 120 }, { nombre: "Armado", min: 240 }, { nombre: "Instalación", min: 180 }], paradaMin: 60 }, 9000);
  assert.equal(c.fabricaMin, 360);
  assert.equal(c.instalacionMin, 180);
  assert.equal(c.fabrica, 54000);
  assert.equal(c.paradas, 9000);
  assert.equal(c.instalacion, 27000);
  assert.equal(c.total, 90000);
  assert.equal(costoOp({ etapas: [] }, null), null, "sin costo cargado no hay costo");
  assert.equal(costoOp({ etapas: [] }, 0), null);
  assert.equal(costoDe(30, 9000), 4500);
});

test("costo — la instalación se reconoce por el nombre de la etapa", () => {
  for (const n of ["Instalación", "INSTALACION", "Instalar en obra", "instalaciones"]) assert.ok(esEtapaDeInstalacion({ nombre: n }), n);
  for (const n of ["Armado", "Corte", ""]) assert.ok(!esEtapaDeInstalacion({ nombre: n }), n);
  assert.ok(!esEtapaDeInstalacion(undefined));
});

test("costo — pesos con punto de miles y cómo se escribe el costo", () => {
  assert.equal(fmtPesos(12345.6), "$ 12.346");
  assert.equal(fmtPesos(0), "$ 0");
  assert.equal(leerPesos("9.500"), 9500);
  assert.equal(leerPesos("$ 12.500,50"), 12500.5);
  assert.equal(leerPesos("9500"), 9500);
  assert.equal(leerPesos("9500.5"), 9500.5);
  assert.equal(leerPesos(""), null);
  assert.equal(leerPesos("diez"), null);
  assert.equal(leerPesos("-5"), null);
});

test("indicadores — horas de instalación y paradas de cada OT para el costo", () => {
  const ind = calcularIndicadores({ tareas: TAREAS, etapas: ETAPAS, hoy: "2026-10-13" });
  assert.equal(ind.instalacionMin, 180);
  const ot = ind.ots.find((o) => o.ot === "7495");
  assert.equal(ot.min, 540, "las paradas no suman a las horas trabajadas");
  assert.equal(ot.paradaMin, 60);
  assert.equal(ot.instalacionMin, 180);
});

test("migración 102 — costo de la hora que solo lee y cambia el dueño", () => {
  const sql = readFileSync(new URL("../supabase/migrations/102_costo_hora.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.costos_empresa/);
  assert.match(sql, /empresa_id\s+uuid primary key references public\.empresa\(id\) on delete cascade/);
  assert.match(sql, /alter table public\.costos_empresa enable row level security/);
  assert.equal(sql.match(/->>'rol'\) = 'gerencial'/g)?.length, 2, "en using y en with check");
  assert.match(sql, /grant select, insert, update on public\.costos_empresa to authenticated/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
});

test("esquema — el costo es un número entre 0 y 99.999.999, con centavos", () => {
  assert.equal(costoHoraBody.parse({ costo_hora: 9500.555 }).costo_hora, 9500.56);
  assert.ok(!costoHoraBody.safeParse({ costo_hora: -1 }).success);
  assert.ok(!costoHoraBody.safeParse({ costo_hora: "9500" }).success);
  assert.ok(!costoHoraBody.safeParse({ costo_hora: 1, empresa_id: E }).success);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function req(t, body) {
  return new Request("http://localhost/api/costo-hora", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function mockCosto({ fila = null, falla = null } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (u) => u.includes("/rest/v1/costos_empresa"),
      respond: (u, o) => {
        if (falla) return { status: 404, body: { message: falla } };
        if (!o?.method || o.method === "GET") return { status: 200, body: fila ? [fila] : [] };
        escrito.push({ metodo: o.method, url: u, body: JSON.parse(o.body) });
        return { status: 200, body: [JSON.parse(o.body)] };
      },
    },
  ]);
  return escrito;
}

test("/api/costo-hora — ni el supervisor, ni el administrativo, ni el operario ven ni cambian el costo", async () => {
  const escrito = mockCosto({ fila: { costo_hora: 9000, empresa_id: E } });
  for (const rol of ["operativo", "administrativo", "supervisor"]) {
    const get = await api.GET(req(await token(rol)));
    assert.equal(get.status, 403, `GET ${rol}`);
    assert.equal((await get.json()).costo_hora, undefined);
    const post = await api.POST(req(await token(rol), { costo_hora: 1 }));
    assert.equal(post.status, 403, `POST ${rol}`);
  }
  assert.equal(escrito.length, 0);
});

test("/api/costo-hora — el dueño lo lee y lo guarda en su empresa", async () => {
  mockCosto({ fila: { costo_hora: "9000.00" } });
  let res = await api.GET(req(await token("gerencial")));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).costo_hora, 9000);

  mockCosto();
  res = await api.GET(req(await token("gerencial")));
  assert.equal((await res.json()).costo_hora, null, "todavía no se cargó");

  let escrito = mockCosto();
  res = await api.POST(req(await token("gerencial"), { costo_hora: 9500 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "POST");
  assert.equal(escrito[0].body.empresa_id, E);
  assert.equal(escrito[0].body.costo_hora, 9500);
  assert.equal(escrito[0].body.actualizado_por, EMP);

  escrito = mockCosto({ fila: { empresa_id: E } });
  res = await api.POST(req(await token("gerencial"), { costo_hora: 10000 }));
  assert.equal(res.status, 200);
  assert.equal(escrito[0].metodo, "PATCH");
  assert.match(escrito[0].url, new RegExp(`empresa_id=eq\\.${E}`));
  assert.equal(escrito[0].body.empresa_id, undefined, "no se cambia de empresa");

  escrito = mockCosto();
  res = await api.POST(req(await token("gerencial"), { costo_hora: -10 }));
  assert.equal(res.status, 400);
  assert.equal(escrito.length, 0);
});

test("/api/costo-hora — sin la migración 102 la lectura sigue y guardar avisa qué falta", async () => {
  mockCosto({ falla: 'relation "public.costos_empresa" does not exist' });
  let res = await api.GET(req(await token("gerencial")));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { costo_hora: null, falta_migracion: true });
  res = await api.POST(req(await token("gerencial"), { costo_hora: 9500 }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 102/);
});

// ─── Pantallas ───

function mockData() {
  global.fetch = async (url, opts) => {
    const path = JSON.parse(opts.body).path || "";
    if (path.startsWith("registro_actividades")) return new Response(JSON.stringify({ data: TAREAS }), { status: 200 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
}

test("detalle de la OP — el dueño ve el costo separado; sin costo no aparece", async () => {
  mockData();
  const proyecto = { ot: "7495", cliente: "Siciliano" };
  const { unmount } = render(<DetalleOp proyecto={proyecto} empresaId={E} etapas={ETAPAS} costoHora={9000} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Costo de mano de obra (solo lo ves vos)")));
  const costo = screen.getByRole("region", { name: "Costo de mano de obra" });
  assert.match(costo.textContent, /Fábrica6 h\$ 54\.000/);
  assert.match(costo.textContent, /Paradas en esta OT1 h\$ 9\.000/);
  assert.match(costo.textContent, /Instalación3 h\$ 27\.000/);
  assert.match(costo.textContent, /Total\$ 90\.000/);
  unmount();

  mockData();
  render(<DetalleOp proyecto={proyecto} empresaId={E} etapas={ETAPAS} onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText("Horas por etapa")));
  assert.equal(screen.queryAllByText(/Costo de mano de obra/).length, 0);
});

test("indicadores — el dueño ve el costo del período y de cada OT", async () => {
  mockData();
  render(<Indicadores fechaDesde="2026-10-13" fechaHasta="2026-10-13" labelPeriodo="Hoy" empresaId={E} etapas={ETAPAS} costoHora={9000} />);
  await waitFor(() => assert.ok(screen.getByText("Costo de mano de obra (solo lo ves vos)")));
  const seccion = screen.getByRole("region", { name: "Costo de mano de obra (solo lo ves vos)" });
  assert.match(seccion.textContent, /Total del período/);
  assert.match(seccion.textContent, /\$ 90\.000/);
  assert.ok(screen.getByText(/Costo \$ 90\.000/), "OT 7495: trabajo más paradas");
});

test("indicadores — sin costo (supervisor) no aparece ningún peso", async () => {
  mockData();
  render(<Indicadores fechaDesde="2026-10-13" fechaHasta="2026-10-13" labelPeriodo="Hoy" empresaId={E} etapas={ETAPAS} />);
  await waitFor(() => assert.ok(screen.getByText("Tiempo parado")));
  assert.equal(screen.queryAllByText(/\$/).length, 0);
});

test("Configuración → Costo — carga el valor y guarda el nuevo", async () => {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (opts.method === "POST") {
      pedidos.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, costo_hora: 9500 }), { status: 200 });
    }
    return new Response(JSON.stringify({ costo_hora: 9000 }), { status: 200 });
  };
  const avisos = [];
  render(<CostoEditor avisar={(m) => avisos.push(m)} />);
  await waitFor(() => assert.ok(screen.getByText("Ahora: $ 9.000 por hora.")));
  const input = screen.getByLabelText("Costo de la hora ($)");
  assert.equal(input.value, "9000");
  assert.ok(screen.getByText("Guardar costo").disabled, "sin cambios no se guarda");
  fireEvent.change(input, { target: { value: "9.500" } });
  fireEvent.click(screen.getByText("Guardar costo"));
  await waitFor(() => assert.equal(avisos.length, 1));
  assert.deepEqual(pedidos, [{ costo_hora: 9500 }]);
  assert.ok(screen.getByText("Ahora: $ 9.500 por hora."));
  fireEvent.change(input, { target: { value: "nueve mil" } });
  assert.ok(screen.getByText(/Escribí solo el número/));
  assert.ok(screen.getByText("Guardar costo").disabled);
});
