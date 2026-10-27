// tests/material-ot.test.jsx — Planificación de la producción, parte 37
// (migración 136; diseño en notes/diseno-planificacion-produccion.md): la
// sincronización lee del Plan de trabajo PLA 18, FONDOS, CANTOS y MECANIZADOS
// (columnas X a AA), los suma por OT y el Detalle de la OT los muestra.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { parseCsvProyectos, numeroPlanilla } from "../app/lib/csvProyectos.js";
import { materialOt } from "../app/lib/ot.js";

const { default: DetalleOp } = await import("../app/components/DetalleOp.jsx");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const CSV_URL = "https://files.example.com/plan.csv";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

// Títulos reales del PLAN (fila 3), de la A a la AB
const TITULOS = "OT,DIVISIÓN,PROYECTO / OBRA,CLIENTE ,OBRA,DESCRIPCION,CANT,PPTO,ENTREGA,SEMANA ,TERMINADO,DIS,SKP,INFO PROY,RELEV,N.P,N.F,EXCEL,PERF/ESPEJO/VIDRIO,PDF,CORTE,MESADA,HS,PLA 18,FONDOS,CANTOS,MECANIZADOS,FECHA";
const renglon = (ot, desc, cant, pla, fondos, cantos, mec) =>
  `${ot},MUEBLES,7473,GI DESARROLLISTA,LOTE 34-5,${desc},${cant},,si,38,NO,GR,GR,GR,GR,GR,SLS,SLS,SLS,SLS,MJT,SLS,1100,${pla},${fondos},${cantos},${mec},8/9/2026`;

test("numeroPlanilla — coma decimal, punto de miles, vacío y N/A", () => {
  assert.equal(numeroPlanilla("21,8"), 21.8);
  assert.equal(numeroPlanilla("287"), 287);
  assert.equal(numeroPlanilla("1.200"), 1200);
  assert.equal(numeroPlanilla("1.200,5"), 1200.5);
  assert.equal(numeroPlanilla("2.5"), 2.5);
  assert.equal(numeroPlanilla(""), null);
  assert.equal(numeroPlanilla("N/A"), null);
  assert.equal(numeroPlanilla("-3"), null);
});

test("planilla — lee X a AA por título, suma los renglones de la OT y no los confunde con CANT", () => {
  const { filas } = parseCsvProyectos([
    TITULOS,
    renglon("M-7473", "COCINA + ISLA", 2, '"21,8"', '"2,8"', 287, ""),
    renglon("M-7473", "ALACENAS", 1, 3, "N/A", '"12,5"', 2),
    renglon("M-7474", "VANITORY", 1, "", "", "", ""),
  ].join("\n"));
  const ot = (n) => filas.find((f) => f.ot === n);
  assert.equal(ot("M-7473").placas, 24.8);
  assert.equal(ot("M-7473").fondos, 2.8);
  assert.equal(ot("M-7473").metros_canto, 299.5);
  assert.equal(ot("M-7473").placas_mecanizadas, 2);
  // CANT sigue saliendo de su columna (son el total del renglón, no se multiplican)
  assert.equal(ot("M-7473").cantidad, 3);
  assert.equal(ot("M-7474").placas, null);
  assert.equal(ot("M-7474").placas_mecanizadas, null);
});

test("planilla sin esas columnas — las claves no van, así no pisan lo que ya había", () => {
  const { filas } = parseCsvProyectos("OT,CLIENTE,CANT\nM-1,Ana,2\n");
  assert.equal(filas[0].cantidad, 2);
  for (const k of ["placas", "fondos", "metros_canto", "placas_mecanizadas"]) assert.equal(k in filas[0], false);
});

function mockSync(csv, { sinMigracion = false } = {}) {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && (!o?.method || o.method === "GET"), respond: (u) => ({ status: 200, body: u.includes("ot_fecha_objetivo") ? [] : [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: csv }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u, o) => u.includes("/rest/v1/proyectos?"),
      respond: (u, o) => {
        const body = JSON.parse(o.body);
        if (sinMigracion && o.method === "POST" && body.some((r) => "placas" in r)) {
          return { status: 400, body: { message: "Could not find the 'placas' column of 'proyectos' in the schema cache" } };
        }
        pedidos.push({ method: o.method, body });
        return { status: 200, body: null };
      },
    },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  return pedidos;
}

async function sincronizar() {
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  return res.json();
}

test("sync — sube placas, fondos, cantos y mecanizados de cada OT", async () => {
  const pedidos = mockSync([TITULOS, renglon("M-7473", "COCINA", 1, '"21,8"', '"2,8"', 287, "")].join("\n"));
  assert.equal((await sincronizar()).procesados, 1);
  const subida = pedidos.filter((p) => p.method === "POST").flatMap((p) => p.body).find((r) => r.ot === "M-7473");
  assert.equal(subida.placas, 21.8);
  assert.equal(subida.fondos, 2.8);
  assert.equal(subida.metros_canto, 287);
  assert.equal(subida.placas_mecanizadas, null);
});

test("sync — sin la migración 136 en la base igual sincroniza", async () => {
  const pedidos = mockSync([TITULOS, renglon("M-7473", "COCINA", 1, 5, 1, 80, "")].join("\n"), { sinMigracion: true });
  const r = await sincronizar();
  assert.equal(r.procesados, 1);
  assert.deepEqual(r.errores, []);
  const subida = pedidos.filter((p) => p.method === "POST").flatMap((p) => p.body).find((x) => x.ot === "M-7473");
  assert.equal("placas" in subida, false);
  assert.equal(subida.cliente, "GI DESARROLLISTA");
});

test("materialOt — solo los datos que trae la planilla, en formato argentino", () => {
  assert.deepEqual(materialOt({ placas: 21.8, fondos: 2.8, metros_canto: 1287, placas_mecanizadas: null }), [
    { label: "Placas 18", valor: "21,8" },
    { label: "Fondos", valor: "2,8" },
    { label: "Cantos", valor: "1.287 m" },
  ]);
  assert.deepEqual(materialOt({ ot: "1" }), []);
});

test("DetalleOp — muestra 🪵 Material de producción", async () => {
  global.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  render(<DetalleOp proyecto={{ ot: "7473", cliente: "GI", placas: 21.8, fondos: 2.8, metros_canto: 287 }} empresaId="emp-1" etapas={[]} divisiones={[]} onClose={() => {}} />);
  const seccion = await screen.findByRole("region", { name: "Material de producción" });
  assert.match(seccion.textContent, /Placas 1821,8/);
  assert.match(seccion.textContent, /Cantos287 m/);
  assert.equal(/Mecanizados/.test(seccion.textContent), false);
});

test("DetalleOp — OT sin esos datos no muestra la sección", async () => {
  global.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  render(<DetalleOp proyecto={{ ot: "7474" }} empresaId="emp-1" etapas={[]} divisiones={[]} onClose={() => {}} />);
  await screen.findByText(/Orden 7474/);
  assert.equal(screen.queryByRole("region", { name: "Material de producción" }), null);
});

// ─── PRECIO de cada OT (Tadeo, 27/10; migración 142) ────────────────────────
const { precioPlanilla } = await import("../app/lib/csvProyectos.js");
const TITULOS_PRECIO = `${TITULOS},COSTO MAT, MAT U$S,PRECIO,U$S`;
const conPrecio = (fila, precio) => `${fila},,,${precio},`;

test("precioPlanilla y planilla — PRECIO en pesos, sumado entre los renglones de la OT", () => {
  assert.equal(precioPlanilla("$38.352.296,68"), 38352296.68);
  assert.equal(precioPlanilla("$ 1.200"), 1200);
  assert.equal(precioPlanilla(""), null);
  assert.equal(precioPlanilla("A CONFIRMAR"), null);
  const { filas } = parseCsvProyectos([
    TITULOS_PRECIO,
    conPrecio(renglon("M-7473", "COCINA", 1, 5, 1, 80, ""), '"$1.000.000,50"'),
    conPrecio(renglon("M-7473", "ALACENA", 1, 1, "", 10, ""), '"$500.000"'),
    conPrecio(renglon("M-7474", "VANITORY", 1, "", "", "", ""), ""),
  ].join("\n"));
  const ot = (n) => filas.find((f) => f.ot === n);
  assert.equal(ot("M-7473").precio, 1500000.5);
  assert.equal(ot("M-7474").precio, null);
  assert.equal("precio" in parseCsvProyectos("OT,CLIENTE\nM-1,Ana\n").filas[0], false, "sin la columna no va");
});

test("sync — el precio va a precios_ot con service_role, no a proyectos", async () => {
  const pedidos = mockSync([TITULOS_PRECIO, conPrecio(renglon("M-7473", "COCINA", 1, 5, 1, 80, ""), '"$2.500.000"')].join("\n"));
  const precios = [];
  const previo = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("/rest/v1/precios_ot")) {
      precios.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
      return new Response(null, { status: 201 });
    }
    return previo(url, opts);
  };
  assert.equal((await sincronizar()).procesados, 1);
  const subida = pedidos.filter((p) => p.method === "POST").flatMap((p) => p.body).find((r) => r.ot === "M-7473");
  assert.equal("precio" in subida, false, "proyectos no guarda el precio");
  assert.equal(precios.length, 1);
  assert.match(precios[0].url, /on_conflict=empresa_id,ot/);
  assert.deepEqual(precios[0].body.map((r) => [r.empresa_id, r.ot, r.precio]), [[EMPRESA_ID, "M-7473", 2500000]]);
  const auth = precios[0].headers.Authorization || precios[0].headers.authorization;
  assert.equal(auth, "Bearer test-service-key", "con service_role");
});

test("sync — sin la migración 142 igual sincroniza las OT", async () => {
  mockSync([TITULOS_PRECIO, conPrecio(renglon("M-7473", "COCINA", 1, 5, 1, 80, ""), "1000")].join("\n"));
  const previo = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes("/rest/v1/precios_ot")
    ? new Response(JSON.stringify({ message: 'relation "public.precios_ot" does not exist' }), { status: 404 })
    : previo(url, opts));
  const r = await sincronizar();
  assert.equal(r.procesados, 1);
  assert.deepEqual(r.errores, []);
});

test("DetalleOp — 💲 precio solo si se lo pasan (Dueño y Administración)", async () => {
  global.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  render(<DetalleOp proyecto={{ ot: "7473", cliente: "GI" }} precio={38352296.68} empresaId="emp-1" etapas={[]} divisiones={[]} onClose={() => {}} />);
  assert.ok(await screen.findByText("💲 Precio $ 38.352.297"));
  cleanup();
  render(<DetalleOp proyecto={{ ot: "7473", cliente: "GI" }} empresaId="emp-1" etapas={[]} divisiones={[]} onClose={() => {}} />);
  await screen.findByText(/Orden 7473/);
  assert.equal(screen.queryByText(/💲 Precio/), null);
  const lista = readFileSync(new URL("../app/proyectos_screen.jsx", import.meta.url), "utf8");
  assert.match(lista, /precio=\{verPrecios \? precios\.get\(String\(detalle\.ot\)\) : undefined\}/);
});
