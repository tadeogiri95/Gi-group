// tests/lib-afip.test.js — Kill-switch de la facturación electrónica ARCA/AFIP.
//
// Sin red: el caso por defecto (sin AFIP_ACCESS_TOKEN, que es el estado real
// de producción hasta que se configure) nunca debe instanciar el SDK ni
// intentar una llamada de red — por eso no hace falta mockear axios/fetch
// para este archivo.
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  delete process.env.AFIP_ACCESS_TOKEN;
  delete process.env.AFIP_CUIT;
  delete process.env.AFIP_CERT;
  delete process.env.AFIP_KEY;
});

const { emitirFacturaC } = await import("../app/lib/afip.js");

test("emitirFacturaC — sin AFIP_ACCESS_TOKEN, kill-switch: no hace nada", async () => {
  const res = await emitirFacturaC({ monto: 35000, fechaPago: "2026-06-24" });
  assert.deepEqual(res, { ok: false, motivo: "no_configurado" });
});

test("emitirFacturaC — nunca tira excepción aunque falten todos los datos", async () => {
  await assert.doesNotReject(() => emitirFacturaC({}));
});
