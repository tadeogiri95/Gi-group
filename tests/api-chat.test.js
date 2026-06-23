// tests/api-chat.test.js — Tests HTTP de POST /api/chat (proxy a Anthropic)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/chat/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function token() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  return token;
}

function chatReq(tok, bodyStr) {
  const headers = { "Content-Type": "application/json" };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Request("http://localhost/api/chat", { method: "POST", headers, body: bodyStr });
}

function rateLimitHandler(count) {
  return { match: (url) => url.includes("/rest/v1/rpc/rpc_check_rate_limit"), respond: () => ({ status: 200, body: count }) };
}

function anthropicHandler(status, body) {
  return { match: (url) => url.includes("api.anthropic.com/v1/messages"), respond: () => ({ status, body }) };
}

test("chat — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(chatReq(null, JSON.stringify({ messages: [] })));
  assert.equal(res.status, 401);
});

test("chat — rate limit excedido devuelve 429", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(21)]);
  const tok = await token();
  const res = await POST(chatReq(tok, JSON.stringify({ messages: [] })));
  assert.equal(res.status, 429);
});

test("chat — rate limit fail-closed si la DB no responde", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/rpc/rpc_check_rate_limit"), respond: () => ({ status: 500, body: "error" }) },
  ]);
  const tok = await token();
  const res = await POST(chatReq(tok, JSON.stringify({ messages: [] })));
  assert.equal(res.status, 429, "si la DB de rate limit no responde, debe bloquear (fail-closed)");
});

test("chat — payload mayor a 100KB devuelve 413", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(1)]);
  const tok = await token();
  const res = await POST(chatReq(tok, "x".repeat(100_001)));
  assert.equal(res.status, 413);
});

test("chat — más de 30 mensajes en el historial devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(1)]);
  const tok = await token();
  const messages = Array.from({ length: 31 }, () => ({ role: "user", content: "hola" }));
  const res = await POST(chatReq(tok, JSON.stringify({ messages })));
  assert.equal(res.status, 400);
});

test("chat — sin ANTHROPIC_API_KEY configurada devuelve 500", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(1)]);
    const tok = await token();
    const res = await POST(chatReq(tok, JSON.stringify({ messages: [] })));
    assert.equal(res.status, 500);
  } finally {
    process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("chat — Anthropic responde error devuelve 502", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(1), anthropicHandler(500, { error: "overloaded" })]);
  const tok = await token();
  const res = await POST(chatReq(tok, JSON.stringify({ messages: [{ role: "user", content: "hola" }] })));
  assert.equal(res.status, 502);
});

test("chat — éxito devuelve la respuesta de Anthropic tal cual", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), rateLimitHandler(1), anthropicHandler(200, { id: "msg_1", content: [{ type: "text", text: "Hola!" }], usage: { input_tokens: 10, output_tokens: 5 } })]);
  const tok = await token();
  const res = await POST(chatReq(tok, JSON.stringify({ messages: [{ role: "user", content: "hola" }] })));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.id, "msg_1");
});
