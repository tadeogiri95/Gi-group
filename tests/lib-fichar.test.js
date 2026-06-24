// tests/lib-fichar.test.js — Reintento ante fallo de red en ficharServer().
import { test, before } from "node:test";
import assert from "node:assert/strict";

const { ficharServer } = await import("../app/lib/fichar.js");
const { setToken } = await import("../app/lib/supabase.js");

before(() => {
  setToken("token-test");
});

test("ficharServer — reintenta ante fallo de red y termina OK", async () => {
  let llamadas = 0;
  global.fetch = async () => {
    llamadas++;
    if (llamadas < 3) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ok: true, hora: "08:00" }), { status: 200 });
  };

  const res = await ficharServer("ingreso", { geo_lat: -34.6, geo_lng: -58.4 });
  assert.equal(res.ok, true);
  assert.equal(llamadas, 3, "debe haber reintentado 2 veces antes de tener éxito");
});

test("ficharServer — agota reintentos y tira error tipo sin_conexion", async () => {
  let llamadas = 0;
  global.fetch = async () => { llamadas++; throw new TypeError("Failed to fetch"); };

  await assert.rejects(
    () => ficharServer("ingreso", {}),
    (err) => {
      assert.equal(err.tipo, "sin_conexion");
      return true;
    }
  );
  assert.equal(llamadas, 3, "1 intento inicial + 2 reintentos = 3 llamadas");
});

test("ficharServer — un rechazo lógico del servidor (data.ok=false) no reintenta", async () => {
  let llamadas = 0;
  let bodyEnviado = null;
  global.fetch = async (url, opts) => {
    llamadas++;
    bodyEnviado = opts.body;
    return new Response(JSON.stringify({ ok: false, error: "Ya fichaste hoy", tipo: "ya_fichado" }), { status: 200 });
  };

  await assert.rejects(
    () => ficharServer("ingreso", { geo_lat: 1, geo_lng: 2 }),
    (err) => {
      assert.equal(err.tipo, "ya_fichado");
      return true;
    }
  );
  assert.equal(llamadas, 1, "un rechazo lógico no debe reintentar");
  assert.match(bodyEnviado, /"geo_lat":1/, "la geo ya capturada se manda en el body");
});
