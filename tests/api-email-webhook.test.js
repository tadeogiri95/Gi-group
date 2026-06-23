// tests/api-email-webhook.test.js — Tests HTTP de POST /api/email/webhook (eventos de Resend, firmados con Svix)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createFetchMock } from "./helpers/mockFetch.js";

const RAW_SECRET = Buffer.from("fake-svix-signing-secret-32-bytes!!");
const WH_SECRET = "whsec_" + RAW_SECRET.toString("base64");

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_WEBHOOK_SECRET = WH_SECRET;
});

const { POST, GET } = await import("../app/api/email/webhook/route.js");

function firmar(rawBody, svixId, svixTimestamp) {
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const v1 = crypto.createHmac("sha256", RAW_SECRET).update(signedContent).digest("base64");
  return `v1,${v1}`;
}

function postReq(rawBody, { svixId = "msg_1", svixTimestamp = String(Math.floor(Date.now() / 1000)), firmaValida = true } = {}) {
  const headers = { "Content-Type": "application/json", "svix-id": svixId, "svix-timestamp": svixTimestamp };
  headers["svix-signature"] = firmaValida ? firmar(rawBody, svixId, svixTimestamp) : "v1,firmainvalida";
  return new Request("http://localhost/api/email/webhook", { method: "POST", headers, body: rawBody });
}

test("email/webhook — sin RESEND_WEBHOOK_SECRET configurada devuelve 500 (no bypass)", async () => {
  const prev = process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_SECRET;
  try {
    global.fetch = createFetchMock([]);
    const mod = await import(`../app/api/email/webhook/route.js?t=${Date.now()}`);
    const res = await mod.POST(postReq("{}", { firmaValida: false }));
    assert.equal(res.status, 500);
  } finally {
    process.env.RESEND_WEBHOOK_SECRET = prev;
  }
});

test("email/webhook — firma inválida devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(JSON.stringify({ type: "email.sent" }), { firmaValida: false }));
  assert.equal(res.status, 401);
});

test("email/webhook — timestamp con más de 5 minutos de diferencia devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const tsViejo = String(Math.floor(Date.now() / 1000) - 6 * 60);
  const rawBody = JSON.stringify({ type: "email.sent" });
  const headers = { "Content-Type": "application/json", "svix-id": "msg_1", "svix-timestamp": tsViejo };
  headers["svix-signature"] = firmar(rawBody, "msg_1", tsViejo);
  const res = await POST(new Request("http://localhost/api/email/webhook", { method: "POST", headers, body: rawBody }));
  assert.equal(res.status, 401);
});

test("email/webhook — firma válida pero JSON inválido devuelve 200 ignorado", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq("esto no es json"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ignorado, "json_invalido");
});

test("email/webhook — evento bien formado guarda email_eventos con los campos correctos", async () => {
  let insertado = null;
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/email_eventos") && opts?.method === "POST", respond: (url, opts) => { insertado = JSON.parse(opts.body); return { status: 201, body: null }; } },
  ]);
  const body = {
    type: "email.clicked",
    data: {
      email_id: "em_1",
      to: ["ana@test.com"],
      tags: [{ name: "tipo", value: "recuperar_password" }, { name: "empresa_id", value: "emp-1" }],
      click: { link: "https://gypi.app/reset" },
    },
  };
  const res = await POST(postReq(JSON.stringify(body)));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(insertado.evento, "clicked");
  assert.equal(insertado.tipo_email, "recuperar_password");
  assert.equal(insertado.empresa_id, "emp-1");
  assert.equal(insertado.destinatario, "ana@test.com");
  assert.equal(insertado.link, "https://gypi.app/reset");
});

test("email/webhook — GET devuelve identificación del servicio", async () => {
  const res = await GET();
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.service, "gypi-email-webhook");
});
