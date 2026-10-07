import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { crearRefresco } from "../app/lib/refrescoVisible.js";

// Documento falso: solo lo que usa crearRefresco
function crearDoc() {
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  doc.cambiar = (estado) => {
    doc.visibilityState = estado;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  return doc;
}

const pausa = () => new Promise((r) => setImmediate(r));

describe("crearRefresco (F3-04)", () => {
  let doc, llamadas, r;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
    doc = crearDoc();
    llamadas = 0;
  });

  afterEach(() => {
    r?.detener();
    mock.timers.reset();
  });

  it("recarga en cada intervalo con la pestaña visible", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 1000, doc });
    r.iniciar();
    mock.timers.tick(1000);
    await pausa();
    mock.timers.tick(1000);
    await pausa();
    assert.equal(llamadas, 2);
  });

  it("no recarga con la pestaña oculta y recarga una vez al volver si los datos quedaron viejos", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 1000, doc });
    r.iniciar();
    doc.cambiar("hidden");
    mock.timers.tick(5000);
    await pausa();
    assert.equal(llamadas, 0);
    doc.cambiar("visible");
    await pausa();
    assert.equal(llamadas, 1);
  });

  it("al volver enseguida a la pestaña no recarga si los datos son recientes", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 1000, doc });
    r.iniciar();
    doc.cambiar("hidden");
    mock.timers.tick(300);
    doc.cambiar("visible");
    await pausa();
    assert.equal(llamadas, 0);
  });

  it("agrupa una ráfaga de avisos de Realtime en una sola recarga", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 60000, esperaMs: 1500, doc });
    r.iniciar();
    for (let i = 0; i < 5; i++) {
      r.pedir();
      mock.timers.tick(500);
    }
    assert.equal(llamadas, 0);
    mock.timers.tick(1500);
    await pausa();
    assert.equal(llamadas, 1);
  });

  it("un aviso con la pestaña oculta se aplica al volver, aunque los datos sean recientes", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 60000, doc });
    r.iniciar();
    doc.cambiar("hidden");
    r.pedir();
    mock.timers.tick(5000);
    await pausa();
    assert.equal(llamadas, 0);
    doc.cambiar("visible");
    await pausa();
    assert.equal(llamadas, 1);
  });

  it("no corre dos recargas en paralelo: un pedido durante una recarga se hace al terminar", async () => {
    let terminar;
    let enParalelo = 0;
    let maxParalelo = 0;
    r = crearRefresco(async () => {
      llamadas++;
      enParalelo++;
      maxParalelo = Math.max(maxParalelo, enParalelo);
      await new Promise((res) => { terminar = res; });
      enParalelo--;
    }, { intervaloMs: 1000, doc });
    r.iniciar();
    mock.timers.tick(1000); // arranca la primera
    await pausa();
    mock.timers.tick(1000); // llega otra mientras la primera sigue
    mock.timers.tick(1000);
    await pausa();
    assert.equal(llamadas, 1);
    terminar();
    await pausa();
    await pausa();
    assert.equal(llamadas, 2, "los pedidos acumulados se resuelven con una sola recarga más");
    terminar();
    await pausa();
    assert.equal(maxParalelo, 1);
  });

  it("un error en la recarga no corta el polling", async () => {
    r = crearRefresco(() => { llamadas++; throw new Error("sin red"); }, { intervaloMs: 1000, doc });
    r.iniciar();
    mock.timers.tick(1000);
    await pausa();
    mock.timers.tick(1000);
    await pausa();
    assert.equal(llamadas, 2);
  });

  it("detener() corta el intervalo, la espera y el aviso de visibilidad", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 1000, doc });
    r.iniciar();
    r.pedir();
    r.detener();
    mock.timers.tick(10000);
    doc.cambiar("hidden");
    doc.cambiar("visible");
    await pausa();
    assert.equal(llamadas, 0);
  });

  it("sin document (servidor) funciona como polling común", async () => {
    r = crearRefresco(() => { llamadas++; }, { intervaloMs: 1000, doc: null });
    r.iniciar();
    mock.timers.tick(1000);
    await pausa();
    assert.equal(llamadas, 1);
  });
});
