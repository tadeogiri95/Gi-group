// tests/pagina-cliente-ot.test.jsx — Página de la OT para el cliente (04/11)
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const E = "11111111-1111-4111-8111-111111111111";
const { codigoClienteOt, leerCodigoClienteOt, linkClienteOt } = await import("../app/lib/linkClienteOt.js");
const { datosClienteOt, estadoCliente } = await import("../app/lib/paginaClienteOt.js");
const { leerQr } = await import("../app/lib/escaneoCarga.js");
const { otDeQr } = await import("../app/lib/pdfOt.js");
const { SLUGS_RESERVADOS } = await import("../app/lib/slugs.js");

test("link del cliente — se lee de vuelta y una firma tocada no abre nada", () => {
  const c = codigoClienteOt(E, "M-7498-36");
  assert.deepEqual(leerCodigoClienteOt(c), { empresaId: E, ot: "M-7498-36" });
  const [datos, firma] = c.split(".");
  const otra = Buffer.from(`${E}|M-7498-37`).toString("base64url");
  assert.equal(leerCodigoClienteOt(`${otra}.${firma}`), null, "cambiar la OT sin la firma no sirve");
  assert.equal(leerCodigoClienteOt(`${datos}.${firma.slice(0, -1)}${firma.endsWith("A") ? "B" : "A"}`), null);
  assert.equal(leerCodigoClienteOt("cualquier-cosa"), null);
  assert.equal(codigoClienteOt("no-uuid", "M-1"), null);
  assert.equal(codigoClienteOt(E, "M 1 <x>"), null);
  assert.equal(linkClienteOt("https://gypi.app/", E, "M-7495"), `https://gypi.app/ot/${codigoClienteOt(E, "M-7495")}`);
});

test("los escáneres de Gypi leen la OT del QR del cliente", () => {
  const url = linkClienteOt("https://gypi.app", E, "M-7495");
  assert.deepEqual(leerQr(url), { ot: "M-7495" });
  assert.equal(otDeQr(url), "M-7495");
  assert.ok(SLUGS_RESERVADOS.has("ot"), "ninguna empresa puede tomar el slug ot");
});

test("datosClienteOt — solo lo del cliente: nunca precio, costo ni notas", () => {
  const d = datosClienteOt({
    proyecto: { ot: "M-7495", cliente: "RIOFRIO", obra: "MAIPU 10", descripcion: "COCINA", estado: "activo", fecha_entrega: "2026-11-20", precio: 999999, costo: 1, notas: "interno" },
    avance: [{ ot: "M-7495", etapa: 1, total: 10, pasaron: 10 }, { ot: "M-7495", etapa: 2, total: 10, pasaron: 5 }, { ot: "OTRA", etapa: 1, total: 10, pasaron: 0 }],
    instalacion: null,
    archivos: [{ nombre: "7495-RIOFRIO.pdf", id: "1aaaaaaaaaaaaaaa", fecha: "2026-10-01T00:00:00Z" }],
    empresa: { nombre: "GI", logo_url: "javascript:alert(1)", color_primario: "#F97316" },
  });
  assert.equal(d.produccion, 75);
  assert.equal(d.instalacion, null);
  assert.deepEqual(d.estado, { texto: "En fabricación", tono: "ambar" });
  assert.equal(d.pdf.url, "https://drive.google.com/file/d/1aaaaaaaaaaaaaaa/view");
  assert.equal(d.empresa.logo, null, "solo logos https");
  assert.equal(d.entrega, "20/11/2026");
  const texto = JSON.stringify(d);
  assert.ok(!texto.includes("999999") && !texto.includes("interno"));
});

test("estadoCliente — en palabras del cliente", () => {
  assert.equal(estadoCliente({ acta: { firmada_at: "2026-11-01" } }).texto, "Instalada");
  assert.equal(estadoCliente({ p: { estado: "cerrado" } }).texto, "Terminada");
  assert.equal(estadoCliente({ pausa: { id: 1 }, produccion: 50 }).texto, "En pausa");
  assert.equal(estadoCliente({ instalacion: 40 }).texto, "En instalación");
  assert.equal(estadoCliente({ produccion: 100 }).texto, "Fabricada, lista para instalar");
  assert.equal(estadoCliente({ produccion: 0 }).texto, "En preparación");
});

test("página /ot/<código> — muestra la OT, el avance y el plano; con un código malo, no encontrada", async () => {
  const pedidos = [];
  global.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    pedidos.push(u);
    const json = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (u.includes("/empresa?")) return json([{ nombre: "GI Muebles", logo_url: null }]);
    if (u.includes("/proyectos?")) return json([{ ot: "M-7495", cliente: "RIOFRIO", obra: "MAIPU 10", descripcion: "COCINA", estado: "activo" }]);
    if (u.includes("/v_avance_piezas?")) return json([{ ot: "M-7495", etapa: 1, total: 4, pasaron: 4 }]);
    if (u.includes("/reportes_instalacion?")) return json([{ avance: 30 }]);
    if (u.includes("clave=eq.pdf_ot_script")) return json([{ valor: { hash: "x", archivos: [{ nombre: "7495-RIOFRIO.pdf", id: "1aaaaaaaaaaaaaaa" }] } }]);
    return json([]);
  };
  const { default: Pagina } = await import("../app/ot/[codigo]/page.jsx");
  render(await Pagina({ params: Promise.resolve({ codigo: codigoClienteOt(E, "M-7495") }) }));
  assert.ok(screen.getByText("GI Muebles"));
  assert.ok(screen.getByText("OT M-7495"));
  assert.ok(screen.getByText("En instalación"));
  assert.ok(screen.getByLabelText("🏭 Fabricación: 100 %"));
  assert.ok(screen.getByLabelText("🔧 Instalación: 30 %"));
  assert.equal(screen.getByRole("link", { name: /Ver el plano/ }).getAttribute("href"), "https://drive.google.com/file/d/1aaaaaaaaaaaaaaa/view");
  assert.ok(pedidos.every((u) => u.includes(`empresa_id=eq.${E}`) || u.includes(`/empresa?id=eq.${E}`)), "todo filtrado por la empresa del código");
  cleanup();
  pedidos.length = 0;
  render(await Pagina({ params: Promise.resolve({ codigo: "trucho.AAAAAAAAAAAAAAAAAAAAAA" }) }));
  assert.ok(screen.getByText("No encontramos este proyecto"));
  assert.equal(pedidos.length, 0, "con un código malo no se consulta nada");
});
