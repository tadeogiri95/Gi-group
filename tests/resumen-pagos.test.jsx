// tests/resumen-pagos.test.jsx — 12/11 (migración 186): resumen de órdenes de
// pago para el CFO. Varias órdenes juntas, comprobante opcional, suma de lo
// inmediato (efectivo y transferencia) y de los cheques, link para el CFO
// (aprobar todas) y PDF.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  validarResumen, renglonesResumen, totalesResumen, datosResumenParaCfo, textoWhatsappResumen, htmlResumenPago, puedeEntrar, claseForma,
} from "../app/lib/finanzasResumenPago.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/pagos/route.js");
const resumenApi = await import("../app/api/op/resumen/route.js");
const { aprobarResumen, datosResumenCfo } = await import("../app/lib/resumenPagoCfo.js");
const { default: FinanzasPagos } = await import("../app/components/FinanzasPagos.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const TOKEN = "resumenresumenresumenresumen0123";
const FOTO = `https://test.supabase.co/storage/v1/object/public/reportes-obra/${E}/0b5c3f5e-1c1a-4b7a-9a43-6a9c5a2a1f11.jpg`;
const O1 = {
  id: 1, empresa_id: E, numero: 7, proveedor_nombre: "EGGER ARGENTINA", fecha: "2026-11-12", estado: "borrador", total: 300000, resumen_id: null,
  formas: [{ forma: "transferencia", importe: 200000, cuenta_nombre: "Banco Credicoop" }, { forma: "echeq", importe: 100000, fecha_pago: "2026-12-15" }],
};
const O2 = {
  id: 2, empresa_id: E, numero: 8, proveedor_nombre: "Herrajes Sur", fecha: "2026-11-10", estado: "aprobada", total: 80000, resumen_id: null, comprobante_url: FOTO,
  formas: [{ forma: "efectivo", importe: 50000, cuenta_nombre: "Caja Principal" }, { forma: "cheque_tercero", importe: 30000, banco: "Bancor", numero: "389" }],
};
const O3 = { id: 3, empresa_id: E, numero: 9, proveedor_nombre: "Otro", fecha: "2026-11-11", estado: "anulada", total: 999, formas: [{ forma: "efectivo", importe: 999 }] };

// ─── Reglas ───

test("totales — inmediato = efectivo + transferencia; cheques = e-cheq + terceros; las anuladas no suman", () => {
  const t = totalesResumen([O1, O2, O3]);
  assert.deepEqual([t.inmediato, t.cheques, t.total, t.ordenes, t.aprobadas], [250000, 130000, 380000, 2, 1]);
  assert.equal(claseForma("echeq"), "cheque");
  assert.equal(claseForma("transferencia"), "inmediato");
});

test("renglones — uno por forma, por fecha, con proveedor, medio, importe y comprobante", () => {
  const r = renglonesResumen([O1, O2, O3]);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x.numero), [8, 8, 7, 7], "primero la más vieja");
  assert.equal(r[0].comprobante, FOTO);
  assert.equal(r[1].comprobante, null, "el comprobante va una vez por orden");
  assert.match(r[2].medio, /Transferencia · Banco Credicoop/);
  assert.match(r[3].medio, /E-cheq/);
});

test("validar — al menos una; ni anuladas, ni pagadas, ni de otro resumen", () => {
  assert.match(validarResumen({ fecha: "2026-11-12", ordenes: [] }, [O1]).errores[0], /al menos una/);
  assert.match(validarResumen({ fecha: "2026-11-12", ordenes: [3] }, [O3]).errores[0], /no entra/);
  assert.match(validarResumen({ fecha: "2026-11-12", ordenes: [1] }, [{ ...O1, resumen_id: 4 }]).errores[0], /otro resumen/);
  assert.match(validarResumen({ ordenes: [1] }, [O1]).errores[0], /fecha/);
  const ok = validarResumen({ fecha: "2026-11-12", ordenes: [1, "2", 2], notas: "  urgente " }, [O1, O2]);
  assert.deepEqual([ok.errores, ok.ids, ok.resumen.notas], [[], [1, 2], "urgente"]);
  assert.equal(puedeEntrar({ ...O1, estado: "pagada" }), false);
});

test("CFO, WhatsApp y PDF — muestran las dos sumas; el CFO no ve cuentas", () => {
  const d = datosResumenParaCfo({ numero: 3, fecha: "2026-11-12" }, [O1, O2, O3], { nombre: "Gi" });
  assert.equal(d.ordenes.length, 2);
  assert.equal(d.totales.cheques, 130000);
  assert.ok(!JSON.stringify(d).includes("cuenta"), "sin cuentas contables");
  const w = textoWhatsappResumen({ numero: 3 }, [O1, O2], "https://x/op/resumen/abc", { cfo: "Juan" });
  assert.match(w, /Hola Juan/);
  assert.match(w, /Transferencia, efectivo o inmediato: \$ 250\.000,00/);
  assert.match(w, /Cheques: \$ 130\.000,00/);
  const h = htmlResumenPago({ empresa: { nombre: "Gi" }, resumen: { numero: 3, fecha: "2026-11-12", estado: "enviado" }, ordenes: [O1, O2, { ...O3, proveedor_nombre: "<script>" }] });
  assert.match(h, /Resumen de órdenes de pago N° 3/);
  assert.match(h, /Medio de pago/);
  assert.match(h, /\$ 380\.000,00/);
  assert.ok(h.includes(FOTO));
  assert.ok(!h.includes("<script>"));
});

test("migración 186 — tabla de resúmenes con RLS solo Dueño, sin delete; columnas en la orden", () => {
  const sql = readFileSync(new URL("../supabase/migrations/186_resumen_ordenes_pago.sql", import.meta.url), "utf8");
  assert.match(sql, /do \$mig\$/);
  assert.match(sql, /create table if not exists public\.fin_resumenes_pago/);
  assert.match(sql, /add column if not exists resumen_id/);
  assert.match(sql, /add column if not exists comprobante_url/);
  assert.match(sql, /->>'rol'\) = 'gerencial'/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*fin_resumenes_pago/);
});

// ─── Servidor ───

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
const pedir = async (rol, body) => api.POST(new Request("http://localhost/api/finanzas/pagos", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` }, body: JSON.stringify(body),
}));

function mockApi({ ordenes = [O1, O2], resumenes = [], sin186 = false } = {}) {
  const escrito = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => ({ status: 200, body: [{ id: EMP, nombre: "Tadeo", legajo: 7 }] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [{ valor: { nombre: "Juan" } }] }) },
    { match: (u) => u.includes("/rest/v1/push_tokens"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_resumenes_pago"),
      respond: (u, o) => {
        if (sin186) return { status: 404, body: { code: "42P01", message: 'relation "public.fin_resumenes_pago" does not exist' } };
        if (o?.method === "POST" || o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_resumenes_pago", url: u, metodo: o.method, body });
          if (o.method === "POST") return { status: 201, body: [{ id: 4, ...body }] };
          const r = resumenes.find((x) => u.includes(`id=eq.${x.id}&`)) || { id: 4, numero: 1, estado: "armado" };
          return { status: 200, body: [{ ...r, ...body }] };
        }
        if (u.includes("token=eq.")) return { status: 200, body: resumenes.filter((x) => x.token && u.includes(`token=eq.${x.token}`)) };
        if (u.includes("order=numero.desc&limit=1")) return { status: 200, body: resumenes.slice(0, 1) };
        return { status: 200, body: /[?&]id=eq\./.test(u) ? resumenes.filter((x) => u.includes(`id=eq.${x.id}&`)) : resumenes };
      },
    },
    {
      match: (u) => u.includes("/rest/v1/fin_ordenes_pago"),
      respond: (u, o) => {
        if (o?.method === "PATCH") {
          const body = JSON.parse(o.body);
          escrito.push({ tabla: "fin_ordenes_pago", url: u, metodo: o.method, body });
          const tocadas = u.includes("id=in.(") ? ordenes.filter((x) => u.includes(`${x.id}`) && !x.resumen_id)
            : u.includes("resumen_id=eq.") ? ordenes.filter((x) => x.resumen_id && x.estado === "para_aprobar")
              : ordenes.filter((x) => u.includes(`id=eq.${x.id}&`));
          return { status: 200, body: tocadas.map((x) => ({ ...x, ...body })) };
        }
        if (u.includes("resumen_id=eq.")) return { status: 200, body: ordenes.filter((x) => x.resumen_id) };
        return { status: 200, body: /[?&]id=eq\./.test(u) ? ordenes.filter((x) => u.includes(`id=eq.${x.id}&`)) : ordenes };
      },
    },
  ]);
  return { escrito };
}

test("/api/finanzas/pagos — resumen_crear junta las órdenes con su comprobante; solo el Dueño", async () => {
  const { escrito } = mockApi();
  assert.equal((await pedir("administrativo", { accion: "resumen_crear", resumen: { ordenes: [1], fecha: "2026-11-12" } })).status, 403);
  assert.equal(escrito.length, 0);
  const malo = await pedir("gerencial", { accion: "resumen_crear", resumen: { ordenes: [1], fecha: "2026-11-12" }, comprobantes: { 1: "https://evil.com/x.jpg" } });
  assert.equal(malo.status, 400);
  const res = await pedir("gerencial", { accion: "resumen_crear", resumen: { ordenes: [1, 2], fecha: "2026-11-12" }, comprobantes: { 1: FOTO } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const [nuevo, junta, comp] = escrito;
  assert.deepEqual([nuevo.tabla, nuevo.body.numero, nuevo.body.estado, nuevo.body.cargado_por_nombre], ["fin_resumenes_pago", 1, "armado", "Tadeo"]);
  assert.match(junta.url, /id=in\.\(1,2\)&resumen_id=is\.null/);
  assert.equal(junta.body.resumen_id, 4);
  assert.match(comp.url, /id=eq\.1&/);
  assert.equal(comp.body.comprobante_url, FOTO);
});

test("/api/finanzas/pagos — resumen_mandar: link del resumen y las de borrador pasan a esperar al CFO", async () => {
  const { escrito } = mockApi({ ordenes: [{ ...O1, resumen_id: 4 }, { ...O2, resumen_id: 4 }], resumenes: [{ id: 4, numero: 1, estado: "armado" }] });
  const res = await pedir("gerencial", { accion: "resumen_mandar", id: 4 });
  assert.equal(res.status, 200);
  const d = await res.json();
  const orden = escrito.find((x) => x.tabla === "fin_ordenes_pago");
  assert.match(orden.url, /id=eq\.1&.*estado=eq\.borrador/);
  assert.equal(orden.body.estado, "para_aprobar");
  assert.ok(!escrito.some((x) => x.tabla === "fin_ordenes_pago" && x.url.includes("id=eq.2&")), "la aprobada queda como está");
  const r = escrito.find((x) => x.tabla === "fin_resumenes_pago");
  assert.equal(r.body.estado, "enviado");
  assert.equal(d.url, `http://localhost/op/resumen/${r.body.token}`);
});

test("/api/finanzas/pagos — anular el resumen libera las órdenes; comprobante suelto; sin la 186 avisa", async () => {
  const { escrito } = mockApi({ ordenes: [{ ...O1, resumen_id: 4 }], resumenes: [{ id: 4, numero: 1, estado: "enviado", token: TOKEN }] });
  assert.equal((await pedir("gerencial", { accion: "resumen_anular", id: 4 })).status, 200);
  assert.deepEqual([escrito[0].body.estado, escrito[0].body.token], ["anulado", null]);
  assert.match(escrito[1].url, /resumen_id=eq\.4/);
  assert.equal(escrito[1].body.resumen_id, null);

  const r2 = mockApi();
  assert.equal((await pedir("gerencial", { accion: "comprobante", id: 2, url: null })).status, 200);
  assert.equal(r2.escrito[0].body.comprobante_url, null);

  mockApi({ sin186: true });
  const res = await pedir("gerencial", { accion: "resumen_crear", resumen: { ordenes: [1], fecha: "2026-11-12" } });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /migración 186/);
});

test("CFO — ve el resumen y aprueba todas las que esperan con un solo aviso; link viejo no sirve", async () => {
  const esperando = [{ ...O1, estado: "para_aprobar", token: "ordenordenordenordenorden01", resumen_id: 4 }, { ...O2, resumen_id: 4 }];
  const { escrito } = mockApi({ ordenes: esperando, resumenes: [{ id: 4, empresa_id: E, numero: 1, estado: "enviado", token: TOKEN, fecha: "2026-11-12" }] });
  const d = await datosResumenCfo(TOKEN);
  assert.equal(d.totales.total, 380000);
  assert.equal(d.ordenes.find((o) => o.numero === 7).token, "ordenordenordenordenorden01");
  assert.equal(d.ordenes.find((o) => o.numero === 8).token, null);
  assert.equal(d.cfo, "Juan");
  const r = await aprobarResumen(TOKEN, { nombre: "Juan" }, { messaging: { send: async () => {} } });
  assert.deepEqual(r, { ok: true, aprobadas: 1 });
  const p = escrito.find((x) => x.tabla === "fin_ordenes_pago");
  assert.match(p.url, /resumen_id=eq\.4&estado=eq\.para_aprobar&token=not\.is\.null/);
  assert.deepEqual([p.body.estado, p.body.decidida_por_nombre], ["aprobada", "Juan"]);

  mockApi({ resumenes: [] });
  assert.equal(await datosResumenCfo(TOKEN), null);
  const res = await resumenApi.POST(new Request("http://localhost/api/op/resumen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: TOKEN }) }));
  assert.equal(res.status, 404);
});

// ─── Pantalla ───

test("pantalla — 📋 Resumen para el CFO: tildar órdenes, ver las dos sumas y guardar", async () => {
  const datos = {
    tesoreria: [], proveedores: [], cheques: [], empresa: { nombre: "Gi" }, cfo: { nombre: "Juan", telefono: "" }, links: {},
    ordenes: [O1, O2], resumenes: [], links_resumen: {},
  };
  const enviados = [];
  global.fetch = async (url, o = {}) => {
    if (o.method === "POST") { const b = JSON.parse(o.body); enviados.push(b); return new Response(JSON.stringify({ ok: true, resumen: { id: 4, numero: 1, estado: "armado", fecha: "2026-11-12" }, afuera: 0 }), { status: 200 }); }
    return new Response(JSON.stringify(datos), { status: 200 });
  };
  render(<FinanzasPagos />);
  fireEvent.click(await screen.findByRole("button", { name: "📋 Resumen para el CFO" }));
  fireEvent.click(await screen.findByLabelText("Tildar todas"));
  const totales = screen.getByLabelText("Totales del resumen");
  assert.match(totales.textContent, /inmediato\$ 250\.000,00/);
  assert.match(totales.textContent, /terceros\)\$ 130\.000,00/);
  assert.match(totales.textContent, /2 órdenes\$ 380\.000,00/);
  assert.equal(screen.getAllByLabelText(/comprobante/i).length, 2, "cada orden elegida puede llevar su comprobante");
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => assert.equal(enviados.length, 1));
  assert.deepEqual([enviados[0].accion, enviados[0].mandar, enviados[0].resumen.ordenes], ["resumen_crear", false, [1, 2]]);
});
