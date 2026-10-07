// tests/csrf-ip.test.js — Protección CSRF (F2-18) e IP del cliente (F2-20)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const { validateCsrf } = await import("../app/lib/csrf.js");
const { ipCliente } = await import("../app/lib/ip.js");

const HOST = "https://gypi.app";
function req(path, { method = "POST", headers = {} } = {}) {
  return new NextRequest(`${HOST}${path}`, { method, headers });
}

test("csrf — un GET nunca se bloquea", () => {
  assert.equal(validateCsrf(req("/api/data", { method: "GET" })), null);
});

test("csrf — POST desde la misma web (Origin propio) pasa", () => {
  assert.equal(validateCsrf(req("/api/login-empresa", { headers: { origin: HOST } })), null);
});

test("csrf — POST con el token doble (cookie + header) pasa", () => {
  const r = req("/api/data", { headers: { cookie: "gypi_csrf=abc123", "x-csrf-token": "abc123" } });
  assert.equal(validateCsrf(r), null);
});

for (const path of ["/api/login-empresa", "/api/superadmin/impersonate", "/api/recuperar-password", "/api/resetear-password", "/api/registro-empresa", "/api/unirse", "/api/logout", "/api/refresh-token"]) {
  test(`csrf — ${path} desde otro sitio se bloquea (ya no está exento)`, async () => {
    const res = validateCsrf(req(path, { headers: { origin: "https://sitio-malicioso.example" } }));
    assert.equal(res?.status, 403);
  });
}

test("csrf — POST sin Origin, sin Referer y sin token se bloquea", () => {
  assert.equal(validateCsrf(req("/api/data"))?.status, 403);
});

for (const path of ["/api/billing/webhook", "/api/email/webhook", "/api/cron/auto-fichaje"]) {
  test(`csrf — ${path} (servicio externo con firma propia) no se bloquea`, () => {
    assert.equal(validateCsrf(req(path)), null);
  });
}

test("ip — prefiere x-real-ip (la pone Vercel)", () => {
  const r = new Request("http://x", { headers: { "x-real-ip": "200.1.2.3", "x-forwarded-for": "6.6.6.6, 200.1.2.3" } });
  assert.equal(ipCliente(r), "200.1.2.3");
});

test("ip — sin x-real-ip usa el primer valor de x-forwarded-for", () => {
  const r = new Request("http://x", { headers: { "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" } });
  assert.equal(ipCliente(r), "1.2.3.4");
});

test("ip — acepta IPv6", () => {
  assert.equal(ipCliente(new Request("http://x", { headers: { "x-real-ip": "2001:db8::1" } })), "2001:db8::1");
});

test("ip — texto que no es una IP se descarta (no llega a la auditoría)", () => {
  const r = new Request("http://x", { headers: { "x-forwarded-for": "<script>alert(1)</script>" } });
  assert.equal(ipCliente(r), "unknown");
  assert.equal(ipCliente(new Request("http://x")), "unknown");
  assert.equal(ipCliente(null), "unknown");
});

test("ip — ninguna ruta lee x-forwarded-for directo (todas usan ipCliente)", async () => {
  const { execFileSync } = await import("node:child_process");
  const salida = execFileSync("grep", ["-rln", "x-forwarded-for", "app", "--include=*.js", "--include=*.ts", "--include=*.tsx"], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(salida, ["app/lib/ip.js"]);
});
