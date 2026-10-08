// tests/factura-c.test.jsx — Factura C al CUIT del cliente y comprobante descargable
// (F6-02, F6-11, D15, ítem 26).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-mp";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const fiscal = await import("../app/lib/perfilFiscal.js");
const { receptorArca } = await import("../app/lib/afip.js");
const { urlQrArca, htmlComprobante, emisorDesdeEnv } = await import("../app/lib/comprobante.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const perfilRoute = await import("../app/api/billing/perfil-fiscal/route.js");
const { GET: comprobante } = await import("../app/api/billing/comprobante/route.js");
const { POST: crearSuscripcion } = await import("../app/api/billing/create-subscription/route.js");
const { default: PerfilFiscal } = await import("../app/components/PerfilFiscal.jsx");

afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const CUIT_OK = "30712345678";

test("cuitValido — dígito verificador y formato", () => {
  assert.equal(fiscal.cuitValido("20-40937847-2"), true, "CUIT de pruebas de ARCA");
  assert.equal(fiscal.cuitValido("20409378471"), false, "verificador incorrecto");
  assert.equal(fiscal.cuitValido("2040937847"), false, "10 dígitos");
  assert.equal(fiscal.formatearCuit("20409378472"), "20-40937847-2");
});

test("validarPerfilFiscal — limpia y exige los cuatro datos", () => {
  const v = fiscal.validarPerfilFiscal({ razon_social: "  Acme   SA ", cuit: "20-40937847-2", condicion_iva: "responsable_inscripto", domicilio_fiscal: "Av. Colón 100, Córdoba" });
  assert.deepEqual(v.perfil, { razon_social: "Acme SA", cuit: "20409378472", condicion_iva: "responsable_inscripto", domicilio_fiscal: "Av. Colón 100, Córdoba" });
  assert.match(fiscal.validarPerfilFiscal({ ...v.perfil, cuit: "123" }).error, /CUIT/);
  assert.match(fiscal.validarPerfilFiscal({ ...v.perfil, condicion_iva: "otra" }).error, /condición/);
  assert.equal(fiscal.perfilCompleto(v.perfil), true);
  assert.equal(fiscal.perfilCompleto({}), false);
});

test("receptorArca — con CUIT factura a ese CUIT (DocTipo 80) con su condición; si no, Consumidor Final", () => {
  assert.deepEqual(receptorArca({ cuit: "20409378472", condicion_iva: "responsable_inscripto" }), { DocTipo: 80, DocNro: 20409378472, CondicionIVAReceptorId: 1 });
  assert.deepEqual(receptorArca({ cuit: "20409378472", condicion_iva: "monotributo" }).CondicionIVAReceptorId, 6);
  assert.deepEqual(receptorArca(null), { DocTipo: 99, DocNro: 0, CondicionIVAReceptorId: 5 });
  assert.deepEqual(receptorArca({ cuit: "111" }), { DocTipo: 99, DocNro: 0, CondicionIVAReceptorId: 5 });
});

const PAGO = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", empresa_id: E, monto: 45000, fecha_pago: "2026-10-05T15:00:00Z",
  cae: "76123456789012", cae_vencimiento: "2026-10-15", numero_comprobante: 12, punto_venta: 2, tipo_comprobante: 11,
  receptor: { razon_social: "Acme <SA>", cuit: "20409378472", condicion_iva: "responsable_inscripto", domicilio_fiscal: "Calle 1" },
};

test("urlQrArca — el QR lleva los datos que pide ARCA (RG 4892)", () => {
  const url = urlQrArca({ emisorCuit: "20111111112", pago: PAGO });
  assert.ok(url.startsWith("https://www.afip.gob.ar/fe/qr/?p="));
  const datos = JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString());
  assert.deepEqual(datos, {
    ver: 1, fecha: "2026-10-05", cuit: 20111111112, ptoVta: 2, tipoCmp: 11, nroCmp: 12, importe: 45000,
    moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: 20409378472, tipoCodAut: "E", codAut: 76123456789012,
  });
});

test("htmlComprobante — datos de las dos partes, CAE y QR; escapa lo cargado por el cliente", async () => {
  const html = await htmlComprobante({ pago: PAGO, emisor: emisorDesdeEnv({ AFIP_RAZON_SOCIAL: "Juan Pérez", AFIP_CUIT: "20-11111111-2" }), plan: "Planta", periodo: "1/10/2026 al 31/10/2026" });
  assert.ok(html.includes("Juan Pérez"));
  assert.ok(html.includes("00002") && html.includes("00000012"));
  assert.ok(html.includes("Acme &lt;SA&gt;") && !html.includes("Acme <SA>"));
  assert.ok(html.includes("20-40937847-2") && html.includes("IVA Responsable Inscripto"));
  assert.ok(html.includes("76123456789012"));
  assert.ok(html.includes("<svg"));
  const cf = await htmlComprobante({ pago: { ...PAGO, receptor: null }, emisor: emisorDesdeEnv({}) });
  assert.ok(cf.includes("Consumidor Final"));
});

async function tk(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 1, rol })).token;
}
const req = async (url, init = {}, rol) => new Request(url, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk(rol)}` } });

test("/api/billing/perfil-fiscal — solo el dueño; valida y guarda limpio", async () => {
  let patch = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: () => ({ status: 201, body: [] }) },
    { match: (url, o) => url.includes("/rest/v1/empresa?id=eq.") && o?.method === "PATCH", respond: (url, o) => { patch = JSON.parse(o.body); return { status: 204, body: null }; } },
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ razon_social: null, cuit: null, condicion_iva: null, domicilio_fiscal: null }] }) },
  ]);
  assert.equal((await perfilRoute.GET(await req("http://localhost/api/billing/perfil-fiscal", {}, "administrativo"))).status, 403);
  const get = await (await perfilRoute.GET(await req("http://localhost/api/billing/perfil-fiscal"))).json();
  assert.equal(get.completo, false);
  const malo = await perfilRoute.PUT(await req("http://localhost/api/billing/perfil-fiscal", { method: "PUT", body: JSON.stringify({ razon_social: "Acme", cuit: "1", condicion_iva: "monotributo", domicilio_fiscal: "Calle 123" }) }));
  assert.equal(malo.status, 400);
  assert.equal(patch, null);
  const ok = await perfilRoute.PUT(await req("http://localhost/api/billing/perfil-fiscal", { method: "PUT", body: JSON.stringify({ razon_social: "Acme", cuit: "20-40937847-2", condicion_iva: "monotributo", domicilio_fiscal: "Calle 123", plan_activo: "pro" }) }));
  assert.equal(ok.status, 200);
  assert.deepEqual(patch, { razon_social: "Acme", cuit: "20409378472", condicion_iva: "monotributo", domicilio_fiscal: "Calle 123" }, "solo los datos fiscales");
});

test("create-subscription — sin datos de facturación no deja contratar", async () => {
  let mp = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("select=razon_social"), respond: () => ({ status: 200, body: [{ razon_social: "Acme", cuit: null }] }) },
    { match: (url) => url.includes("api.mercadopago.com"), respond: () => { mp = true; return { status: 201, body: {} }; } },
  ]);
  const res = await crearSuscripcion(await req("http://localhost/api/billing/create-subscription", { method: "POST", body: JSON.stringify({ plan: "pro" }) }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).falta_perfil_fiscal, true);
  assert.equal(mp, false);
});

test("/api/billing/comprobante — solo pagos de la propia empresa y con CAE", async () => {
  const pedidos = [];
  const mock = (pago) => {
    global.fetch = createFetchMock([
      ...authPassHandlers(),
      { match: (url) => url.includes("/rest/v1/pagos?id=eq."), respond: (url) => { pedidos.push(url); return { status: 200, body: pago ? [pago] : [] }; } },
      { match: (url) => url.includes("/rest/v1/suscripciones"), respond: () => ({ status: 200, body: [{ plan: "pro", periodo_inicio: "2026-10-01", periodo_fin: "2026-10-31" }] }) },
    ]);
  };
  mock(null);
  assert.equal((await comprobante(await req(`http://localhost/api/billing/comprobante?id=${PAGO.id}`))).status, 404);
  assert.ok(pedidos[0].includes(`empresa_id=eq.${E}`), "nunca se busca un pago de otra empresa");
  assert.equal((await comprobante(await req("http://localhost/api/billing/comprobante?id=x'or"))).status, 400);
  mock({ ...PAGO, cae: null });
  assert.equal((await comprobante(await req(`http://localhost/api/billing/comprobante?id=${PAGO.id}`))).status, 409);
  mock({ ...PAGO, suscripcion_id: "s1" });
  const ok = await comprobante(await req(`http://localhost/api/billing/comprobante?id=${PAGO.id}`));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("Content-Type"), /text\/html/);
  assert.match(await ok.text(), /Plan Pro/);
  assert.equal((await comprobante(await req(`http://localhost/api/billing/comprobante?id=${PAGO.id}`, {}, "administrativo"))).status, 403);
});

test("PerfilFiscal — sin datos abre el formulario, valida el CUIT y guarda", async () => {
  const puts = [];
  global.fetch = async (url, opts) => {
    if (opts?.method === "PUT") { puts.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, ...JSON.parse(opts.body), completo: true }), { status: 200 }); }
    return new Response(JSON.stringify({ completo: false }), { status: 200 });
  };
  let completo = false;
  render(<PerfilFiscal onCompleto={() => { completo = true; }} />);
  fireEvent.change(await screen.findByLabelText("Razón social"), { target: { value: "Acme SA" } });
  fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20-40937847-1" } });
  fireEvent.change(screen.getByLabelText("Condición frente al IVA"), { target: { value: "responsable_inscripto" } });
  fireEvent.change(screen.getByLabelText("Domicilio fiscal"), { target: { value: "Av. Colón 100" } });
  fireEvent.click(screen.getByText("Guardar datos de facturación"));
  assert.ok(await screen.findByText(/El CUIT no es válido/));
  assert.equal(puts.length, 0);
  fireEvent.change(screen.getByLabelText("CUIT"), { target: { value: "20-40937847-2" } });
  fireEvent.click(screen.getByText("Guardar datos de facturación"));
  await waitFor(() => assert.equal(completo, true));
  assert.equal(puts[0].cuit, "20409378472");
  assert.ok(screen.getByText(/CUIT 20-40937847-2 · IVA Responsable Inscripto/));
});
