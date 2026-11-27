// tests/rotulo-articulos.test.jsx — Foto de cada artículo y rótulo con QR
// (pedido de Tadeo 26/11; migración 211): la foto se pone desde la ficha,
// la ruta solo deja a dueños y administradores, y el rótulo lleva la foto.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { htmlEtiquetasArticulos, rotuloConFoto } from "../app/lib/stock.js";
import { fotoArticuloBody } from "../app/lib/schemas.ts";
import { MIGRACIONES } from "../app/lib/esquemaMigraciones.js";
import { CUARTO_A4_ARTICULO, OCTAVO_A4, SEXTO_A4, TAMANOS_ARTICULO } from "../app/lib/carga.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/stock/articulos/route.js");
const { default: FichaArticulo } = await import("../app/components/FichaArticulo.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const FOTO = "https://test.supabase.co/storage/v1/object/public/fotos/bisagra.jpg";

// ─── Rótulo ───

const BASE = { empresa: "GI", origen: "https://gypi.app", slug: "gi" };

test("rótulo — con foto: foto, nombre normalizado, SKU y QR; sin foto, como antes", async () => {
  const html = await htmlEtiquetasArticulos({
    ...BASE, tamano: { ancho: 100, alto: 50 },
    articulos: [{ sku: "1.2.3", nombre: "BISAGRA 35-Hafele", foto_url: FOTO }, { sku: "4.5.6", nombre: "TORNILLO" }],
  });
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 2);
  assert.equal((html.match(/<img /g) || []).length, 1, "solo el que tiene foto");
  assert.ok(html.includes(`src="${FOTO}"`));
  assert.match(html, /BISAGRA 35-Hafele/);
  assert.equal((html.match(/<svg/g) || []).length, 2);
  const sinFotos = await htmlEtiquetasArticulos({ ...BASE, tamano: { ancho: 100, alto: 50 }, articulos: [{ sku: "4.5.6", nombre: "TORNILLO" }] });
  assert.ok(!sinFotos.includes("<img"));
  assert.match(sinFotos, /width: 42mm; height: 42mm/, "sin fotos el QR queda del tamaño de siempre");
});

test("rótulo — en el alto va uno abajo del otro; en el de 50 × 30 no entra la foto", async () => {
  const alto = await htmlEtiquetasArticulos({ ...BASE, tamano: { ancho: 62, alto: 100 }, articulos: [{ sku: "1", nombre: "A", foto_url: FOTO }] });
  assert.match(alto, /flex-direction: column/);
  assert.equal(rotuloConFoto({ ancho: 50, alto: 30 }), false);
  const chico = await htmlEtiquetasArticulos({ ...BASE, tamano: { ancho: 50, alto: 30 }, articulos: [{ sku: "1", nombre: "A", foto_url: FOTO }] });
  assert.ok(!chico.includes("<img"));
});

test("rótulo — un link raro no se usa como foto y el texto va escapado", async () => {
  const html = await htmlEtiquetasArticulos({ ...BASE, tamano: { ancho: 100, alto: 75 }, articulos: [
    { sku: "1", nombre: "A", foto_url: "javascript:alert(1)" },
    { sku: "2", nombre: "B", foto_url: 'https://x.test/a.jpg" onerror="x' },
  ] });
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("https://x.test/a.jpg&quot; onerror=&quot;x"));
});

// ─── Ruta PATCH /api/stock/articulos ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}

function mockFoto({ existe = true, sinMigracion = false } = {}) {
  const patches = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    {
      match: (u, o) => u.includes("/rest/v1/articulos_stock") && o.method === "PATCH",
      respond: (u, o) => {
        if (sinMigracion) return { status: 400, body: { message: "Could not find the 'foto_url' column of 'articulos_stock'" } };
        const body = JSON.parse(o.body);
        patches.push({ url: u, body });
        return { status: 200, body: existe ? [{ sku: "1.2.3", ...body }] : [] };
      },
    },
  ]);
  return patches;
}

const ponerFoto = async (rol, body) => api.PATCH(new Request("http://localhost/api/stock/articulos", {
  method: "PATCH", headers: { Authorization: `Bearer ${await token(rol)}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

test("/api/stock/articulos PATCH — dueños y administradores ponen y sacan la foto, solo de su empresa", async () => {
  const patches = mockFoto();
  const res = await ponerFoto("administrativo", { sku: "1.2.3", foto_url: FOTO });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).foto_url, FOTO);
  assert.match(patches[0].url, new RegExp(`empresa_id=eq\\.${E}&sku=eq\\.1\\.2\\.3`));
  assert.deepEqual(patches[0].body, { foto_url: FOTO });
  assert.equal((await ponerFoto("gerencial", { sku: "1.2.3", foto_url: null })).status, 200);
  assert.deepEqual(patches[1].body, { foto_url: null });
});

test("/api/stock/articulos PATCH — operario no; link sin https no; artículo que no está, 404; sin la 211 avisa", async () => {
  mockFoto();
  assert.equal((await ponerFoto("operativo", { sku: "1.2.3", foto_url: FOTO })).status, 403);
  assert.equal((await ponerFoto("gerencial", { sku: "1.2.3", foto_url: "http://x.test/a.jpg" })).status, 400);
  assert.equal((await ponerFoto("gerencial", { sku: "1 2", foto_url: FOTO })).status, 400);
  mockFoto({ existe: false });
  assert.equal((await ponerFoto("gerencial", { sku: "9.9", foto_url: FOTO })).status, 404);
  mockFoto({ sinMigracion: true });
  const res = await ponerFoto("gerencial", { sku: "1.2.3", foto_url: FOTO });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 211/);
});

test("schema — la foto es https o null", () => {
  assert.equal(fotoArticuloBody.safeParse({ sku: "1.2", foto_url: FOTO }).success, true);
  assert.equal(fotoArticuloBody.safeParse({ sku: "1.2", foto_url: null }).success, true);
  assert.equal(fotoArticuloBody.safeParse({ sku: "1.2", foto_url: "ftp://x" }).success, false);
  assert.equal(fotoArticuloBody.safeParse({ sku: "1.2", foto_url: FOTO, otro: 1 }).success, false);
});

// ─── Ficha ───

const ART = { sku: "1.2.3", nombre: "BISAGRA 35", stock: 10, disponible: 8, activo: true, foto_url: null };

function mockFicha() {
  const pedidos = [];
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/api/stock/articulos")) {
      pedidos.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, foto_url: JSON.parse(opts.body).foto_url }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return pedidos;
}

test("ficha — el operario ve la foto pero no la cambia; sin foto no ve nada", () => {
  mockFicha();
  render(<FichaArticulo sku="1.2.3" articulo={{ ...ART, foto_url: FOTO }} usuario={{ rol: "operativo" }} onClose={() => {}} />);
  assert.ok(screen.getByAltText("Foto de BISAGRA 35"));
  assert.equal(screen.queryByText("📷 Cambiar la foto"), null);
  cleanup();
  render(<FichaArticulo sku="1.2.3" articulo={ART} usuario={{ rol: "operativo" }} onClose={() => {}} />);
  assert.equal(screen.queryByLabelText("Foto del artículo"), null);
});

test("ficha — el dueño saca la foto y avisa a la lista", async () => {
  const pedidos = mockFicha();
  const cambios = [];
  render(<FichaArticulo sku="1.2.3" articulo={{ ...ART, foto_url: FOTO }} usuario={{ rol: "gerencial" }} onClose={() => {}} onFoto={(sku, f) => cambios.push([sku, f])} />);
  assert.ok(screen.getByText("📷 Cambiar la foto"));
  fireEvent.click(screen.getByText("Sacar la foto"));
  await waitFor(() => assert.deepEqual(cambios, [["1.2.3", null]]));
  assert.deepEqual(pedidos, [{ sku: "1.2.3", foto_url: null }]);
  assert.ok(screen.getByText("📷 Foto del artículo"));
});

test("migración 211 — columna foto_url, en el chequeo de la base", () => {
  const sql = readFileSync(new URL("../supabase/migrations/211_foto_articulos.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.articulos_stock\s+add column if not exists foto_url text/);
  const m = MIGRACIONES.find((x) => x.n === 211);
  assert.deepEqual(m.tablas, { articulos_stock: ["foto_url"] });
});

test("rótulo — en hoja A4 van de a ocho por hoja (2 × 4), con línea de corte (27/11)", async () => {
  assert.equal(TAMANOS_ARTICULO[0], OCTAVO_A4);
  const articulos = Array.from({ length: 10 }, (_, i) => ({ sku: `1.${i}`, nombre: `ART ${i}`, foto_url: i === 0 ? FOTO : null }));
  const html = await htmlEtiquetasArticulos({ ...BASE, tamano: OCTAVO_A4, articulos });
  assert.match(html, /size: A4 portrait/);
  assert.equal((html.match(/class="hoja"/g) || []).length, 2, "10 rótulos = 2 hojas");
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 10);
  assert.match(html, /grid-template-columns: repeat\(2, 105mm\); grid-template-rows: repeat\(4, 74.25mm\)/);
  assert.match(html, /dashed/);
  assert.equal((html.match(/<img /g) || []).length, 1, "la foto entra en el octavo de A4");
  const rollo = await htmlEtiquetasArticulos({ ...BASE, tamano: { ancho: 100, alto: 50 }, articulos });
  assert.ok(!rollo.includes('class="hoja"'), "en el rollo, uno por página como siempre");
});

test("rótulo — también de a seis (2 × 3) y de a cuatro (2 × 2) por hoja A4, con letra más grande (27/11)", async () => {
  assert.deepEqual(TAMANOS_ARTICULO.slice(0, 3), [OCTAVO_A4, SEXTO_A4, CUARTO_A4_ARTICULO]);
  const articulos = Array.from({ length: 10 }, (_, i) => ({ sku: `1.${i}`, nombre: `ART ${i}`, foto_url: FOTO }));
  const seis = await htmlEtiquetasArticulos({ ...BASE, tamano: SEXTO_A4, articulos });
  assert.match(seis, /size: A4 portrait/);
  assert.equal((seis.match(/class="hoja"/g) || []).length, 2, "10 rótulos de a 6 = 2 hojas");
  assert.match(seis, /grid-template-columns: repeat\(2, 105mm\); grid-template-rows: repeat\(3, 99mm\)/);
  assert.match(seis, /\.hoja \.nombre \{ font-size: 14pt/);
  assert.match(seis, /grid-template-areas: "foto qr" "texto texto"/, "casi cuadrado: foto y QR arriba, texto abajo");
  const cuatro = await htmlEtiquetasArticulos({ ...BASE, tamano: CUARTO_A4_ARTICULO, articulos });
  assert.equal((cuatro.match(/class="hoja"/g) || []).length, 3, "10 rótulos de a 4 = 3 hojas");
  assert.match(cuatro, /grid-template-columns: repeat\(2, 105mm\); grid-template-rows: repeat\(2, 148.5mm\)/);
  assert.match(cuatro, /flex-direction: column/, "el de a cuatro es alto: foto, texto y QR uno abajo del otro");
  assert.match(cuatro, /\.hoja \.nombre \{ font-size: 16pt/);
  assert.equal((cuatro.match(/<img /g) || []).length, 10);
});

// ─── Recortar la foto (27/11, pedido de Tadeo) ───

const R = await import("../app/lib/recorte.js");

test("recorte — arranca con el cuadrado del medio llenando la foto", () => {
  assert.deepEqual(R.vistaInicial(1600, 1200), { zoom: 1, cx: 800, cy: 600 });
  assert.deepEqual(R.areaRecorte(R.vistaInicial(1600, 1200), 1600, 1200), { x: 200, y: 0, lado: 1200 });
  assert.deepEqual(R.medidasGiradas(1600, 1200, 90), { ancho: 1200, alto: 1600 });
  assert.deepEqual(R.medidasGiradas(1600, 1200, 180), { ancho: 1600, alto: 1200 });
});

test("recorte — el cuadrado no se sale de la foto y el zoom tiene tope", () => {
  // Arrastrar mucho a la derecha deja el cuadrado pegado al borde izquierdo
  const v = R.moverVista(R.vistaInicial(1600, 1200), 5000, 0, 300, 1600, 1200);
  assert.equal(R.areaRecorte(v, 1600, 1200).x, 0);
  // Con zoom 2 el cuadrado es la mitad y se puede mover en los dos sentidos
  const z = R.zoomVista(R.vistaInicial(1600, 1200), 2, 1600, 1200);
  assert.equal(R.areaRecorte(z, 1600, 1200).lado, 600);
  const m = R.moverVista(z, 0, -100, 300, 1600, 1200);
  assert.equal(m.cy, 800, "100 px de pantalla = 200 px de foto");
  assert.equal(R.zoomVista(z, 99, 1600, 1200).zoom, R.ZOOM_MAX);
});

test("recorte — alejando se ve la foto entera, centrada, con blanco al costado", () => {
  assert.equal(R.zoomMinimo(1600, 1200), 0.75);
  const v = R.zoomVista(R.vistaInicial(1600, 1200), 0.1, 1600, 1200);
  assert.equal(v.zoom, 0.75);
  assert.deepEqual(R.areaRecorte(R.moverVista(v, 400, 400, 300, 1600, 1200), 1600, 1200), { x: 0, y: -200, lado: 1600 });
});

test("ficha — el dueño puede recortar la foto que ya está; el operario no", () => {
  render(<FichaArticulo sku="1.2.3" articulo={{ ...ART, foto_url: FOTO }} usuario={{ rol: "gerencial" }} onClose={() => {}} />);
  assert.ok(screen.getByText("✂️ Recortar la foto"));
  cleanup();
  render(<FichaArticulo sku="1.2.3" articulo={ART} usuario={{ rol: "gerencial" }} onClose={() => {}} />);
  assert.equal(screen.queryByText("✂️ Recortar la foto"), null, "sin foto no hay nada que recortar");
  cleanup();
  render(<FichaArticulo sku="1.2.3" articulo={{ ...ART, foto_url: FOTO }} usuario={{ rol: "operativo" }} onClose={() => {}} />);
  assert.equal(screen.queryByText("✂️ Recortar la foto"), null);
});

test("recorte — la ventana abre con el marco, la barra de zoom y girar", async () => {
  const { default: RecortarFoto } = await import("../app/components/RecortarFoto.jsx");
  let cancelado = false;
  render(<RecortarFoto fuente={new Blob(["x"], { type: "image/jpeg" })} onListo={() => {}} onCancelar={() => { cancelado = true; }} />);
  assert.ok(screen.getByLabelText("Foto a recortar: arrastrá para moverla"));
  assert.ok(screen.getByLabelText("Acercar o alejar"));
  assert.ok(screen.getByLabelText("Girar la foto"));
  // En las pruebas no hay imágenes de verdad: avisa que no la pudo leer
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  fireEvent.click(screen.getByText("Cancelar"));
  assert.equal(cancelado, true);
});
