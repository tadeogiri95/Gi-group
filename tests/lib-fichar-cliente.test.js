// tests/lib-fichar-cliente.test.js — ficharServer (app/lib/fichar.js), lado navegador.
// Bug real: después de recargar la página el token en memoria es null y
// ficharServer cortaba con "Sin sesión" sin llamar al servidor; el chat lo
// mostraba como "✅ Ingreso registrado".
import { test } from "node:test";
import assert from "node:assert/strict";

const { ficharServer } = await import("../app/lib/fichar.js");

test("ficharServer — sin token en memoria igual llama al servidor (la sesión va en la cookie)", async () => {
  let llamada = null;
  global.fetch = async (url, opts) => {
    llamada = { url, opts };
    return new Response(JSON.stringify({ ok: true, hora: "08:31" }), { status: 200 });
  };
  const res = await ficharServer("ingreso", { geo_lat: -34.6, geo_lng: -58.4 });
  assert.equal(res.ok, true);
  assert.equal(llamada.url, "/api/fichar");
  assert.equal(llamada.opts.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(llamada.opts.body), { accion: "ingreso", geo_lat: -34.6, geo_lng: -58.4 });
});

test("ficharServer — un rechazo del servidor siempre llega como error con tipo", async () => {
  global.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Estás fuera de la zona", tipo: "fuera_de_zona" }), { status: 200 });
  await assert.rejects(ficharServer("ingreso"), (e) => e.tipo === "fuera_de_zona" && /fuera de la zona/.test(e.message));
});

test("ficharServer — error del servidor sin cuerpo JSON también es error (nunca éxito)", async () => {
  global.fetch = async () => new Response("<html>500</html>", { status: 500 });
  await assert.rejects(ficharServer("ingreso"), (e) => e.tipo === "error_servidor");
});

test("ficharServer — sesión vencida (401) avisa con tipo propio", async () => {
  global.fetch = async () => new Response("{}", { status: 401 });
  await assert.rejects(ficharServer("ingreso"), (e) => e.tipo === "sesion_expirada");
});
