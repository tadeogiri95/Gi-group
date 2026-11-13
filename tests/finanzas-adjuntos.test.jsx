// tests/finanzas-adjuntos.test.jsx — Finanzas (13/11, parte 4 del plan de
// Tesorería; migración 187): varios comprobantes (PDF o fotos) por movimiento.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { comprobantesDe, validarComprobantes, columnasComprobantes, falta187, MAX_COMPROBANTES } from "../app/lib/finanzasAdjuntos.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/operaciones/route.js");
const upload = await import("../app/api/upload/route.js");
const { default: Comprobantes } = await import("../app/components/FinanzasComprobantes.jsx");
const { Detalle } = await import("../app/components/FinanzasMovimientos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const BASE = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/`;
const PDF = `${BASE}0b9e3c1a-1111-4222-8333-444455556666.pdf`;
const FOTO = `${BASE}0b9e3c1a-1111-4222-8333-444455557777.jpg`;
const CTX = { supabaseUrl: "https://test.supabase.co", empresaId: E };

test("comprobantes — la lista nueva más la foto vieja de Mi caja, sin repetir", () => {
  assert.deepEqual(comprobantesDe({ comprobante_url: FOTO }), [{ url: FOTO, nombre: "Foto del ticket", tipo: "foto" }]);
  assert.deepEqual(comprobantesDe({ comprobante_url: FOTO, comprobantes: [{ url: FOTO, nombre: "x", tipo: "foto" }] }).length, 1);
  assert.deepEqual(comprobantesDe({ comprobantes: [{ url: PDF, nombre: "Factura.pdf", tipo: "pdf" }] }).map((c) => c.nombre), ["Factura.pdf"]);
  assert.deepEqual(comprobantesDe({}), []);
});

test("comprobantes — solo archivos de la empresa, PDF o foto, hasta 10, sin repetir", () => {
  const ok = validarComprobantes([{ url: PDF, nombre: "Factura A 0001.pdf" }, FOTO, FOTO], CTX);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.lista.map((c) => [c.tipo, c.nombre]), [["pdf", "Factura A 0001.pdf"], ["foto", "Foto"]]);
  assert.match(validarComprobantes([{ url: "https://malo.com/x.pdf" }], CTX).error, /no es válido/);
  assert.match(validarComprobantes([{ url: PDF.replace(E, "99999999-9999-9999-9999-999999999999") }], CTX).error, /no es válido/);
  assert.match(validarComprobantes("x", CTX).error, /no son válidos/);
  const muchos = Array.from({ length: MAX_COMPROBANTES + 1 }, (_, i) => `${BASE}0b9e3c1a-1111-4222-8333-${String(i).padStart(12, "0")}.jpg`);
  assert.match(validarComprobantes(muchos, CTX).error, /Hasta 10/);
  assert.deepEqual(validarComprobantes(null, CTX), { lista: [], error: null });
  assert.deepEqual(columnasComprobantes(ok.lista).comprobante_url, PDF, "el primero queda como comprobante_url");
  assert.equal(columnasComprobantes([]).comprobante_url, null);
  assert.ok(falta187(new Error('column fin_operaciones.comprobantes does not exist')));
  assert.ok(!falta187(new Error("otra cosa")));
});

test("migración 187 — columna con tope de 10 y pasa la foto que ya estaba, en un solo bloque", () => {
  const sql = readFileSync(new URL("../supabase/migrations/187_comprobantes_operacion.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /add column if not exists comprobantes jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /jsonb_array_length\(comprobantes\) <= 10/);
  assert.match(sql, /where comprobante_url is not null\s+and comprobantes = '\[\]'::jsonb/);
});

// ─── Servidor ───

const token = async (rol = "gerencial") => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 1, rol })).token;
const pedir = async (ruta, body, rol) => ruta.POST(new Request("http://localhost/api/x", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));

function mockApi({ sin187 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/storage/v1/object/"), respond: () => ({ status: 200, body: {} }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          if (sin187 && body.comprobantes) return { status: 400, body: { code: "PGRST204", message: "Could not find the 'comprobantes' column of 'fin_operaciones' in the schema cache" } };
          escrito.push({ url: u, body });
          return { status: 200, body: [{ id: 9, ...body }] };
        }
        return { status: 200, body: [] };
      },
    },
  ]);
  return { escrito };
}

test("/api/finanzas/operaciones — comprobantes: cambia la lista y el primero queda como comprobante_url", async () => {
  const { escrito } = mockApi();
  const r = await pedir(api, { accion: "comprobantes", id: 9, comprobantes: [{ url: PDF, nombre: "Factura.pdf" }, { url: FOTO, nombre: "Foto" }] });
  assert.equal(r.status, 200);
  assert.deepEqual([escrito[0].body.comprobante_url, escrito[0].body.comprobantes.length], [PDF, 2]);
  assert.match(escrito[0].url, /id=eq\.9&empresa_id=eq\./);
  const mal = await pedir(api, { accion: "comprobantes", id: 9, comprobantes: [{ url: "https://malo.com/a.pdf" }] });
  assert.equal(mal.status, 400);
  const vacia = await pedir(api, { accion: "comprobantes", id: 9, comprobantes: [] });
  assert.equal(vacia.status, 200);
  assert.deepEqual([escrito[1].body.comprobantes, escrito[1].body.comprobante_url], [[], null], "quitar todos");
  ({ } = mockApi({ sin187: true }));
  const sin = await pedir(api, { accion: "comprobantes", id: 9, comprobantes: [PDF] });
  assert.equal(sin.status, 400);
  assert.match((await sin.json()).error, /migración 187/);
});

test("/api/upload — un PDF solo como comprobante del Dueño", async () => {
  mockApi();
  const pdf = Buffer.from("%PDF-1.4 hola").toString("base64");
  let r = await pedir(upload, { fileBase64: pdf, fileType: "application/pdf", uso: "comprobante" });
  assert.equal(r.status, 200);
  assert.match((await r.json()).url, /\.pdf$/);
  r = await pedir(upload, { fileBase64: pdf, fileType: "application/pdf" });
  assert.equal(r.status, 400, "sin uso: no");
  r = await pedir(upload, { fileBase64: pdf, fileType: "application/pdf", uso: "comprobante" }, "operativo");
  assert.equal(r.status, 400, "otro rol: no");
  r = await pedir(upload, { fileBase64: Buffer.from("no soy pdf").toString("base64"), fileType: "application/pdf", uso: "comprobante" });
  assert.equal(r.status, 400);
});

// ─── Pantallas ───

test("Comprobantes — lista con su link, quitar uno, y el botón de adjuntar acepta PDF y fotos", () => {
  let lista = [{ url: PDF, nombre: "Factura.pdf", tipo: "pdf" }, { url: FOTO, nombre: "Ticket", tipo: "foto" }];
  render(<Comprobantes lista={lista} onCambio={(l) => { lista = l; }} />);
  assert.equal(screen.getByRole("link", { name: "Factura.pdf" }).getAttribute("href"), PDF);
  assert.equal(screen.getByLabelText("Adjuntar comprobante").getAttribute("accept"), "image/*,application/pdf");
  assert.equal(screen.getByLabelText("Adjuntar comprobante").multiple, true);
  fireEvent.click(screen.getByRole("button", { name: "Quitar Ticket" }));
  assert.deepEqual(lista.map((c) => c.nombre), ["Factura.pdf"]);
});

test("Detalle — se adjunta o se quita un comprobante de un movimiento ya guardado", async () => {
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    enviados.push(JSON.parse(o.body));
    return new Response(JSON.stringify({ ok: true, comprobantes: JSON.parse(o.body).comprobantes }), { status: 200 });
  };
  const op = { id: 5, fecha: "2026-11-09", tipo: "PAGO EFECTIVO", total: 100, cuenta_debe: "a", cuenta_haber: "b", origen: "manual", comprobante_url: FOTO };
  let recargas = 0;
  render(<Detalle op={op} datos={{ tipos: [], cuentas: [] }} onCerrar={() => {}} onAnulada={() => {}} onAdjuntos={() => { recargas++; }} />);
  assert.ok(screen.getByRole("link", { name: "Foto del ticket" }), "la foto de Mi caja se ve como comprobante");
  fireEvent.click(screen.getByRole("button", { name: "Quitar Foto del ticket" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual(enviados[0], { accion: "comprobantes", id: 5, comprobantes: [] });
  await waitFor(() => assert.equal(recargas, 1));
  assert.equal(screen.queryByRole("link", { name: "Foto del ticket" }), null);
});
