// tests/sw-notificationclick.test.js — El service worker solo abre URLs del
// mismo origen al tocar una notificación (F2-08).
//
// Se ejecuta public/firebase-messaging-sw.js en un contexto aislado con un
// `self` simulado y se dispara el evento notificationclick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const codigo = readFileSync(new URL("../public/firebase-messaging-sw.js", import.meta.url), "utf8");
const ORIGEN = "https://gypi.app";

function cargarSW({ ventanas = [] } = {}) {
  const listeners = {};
  const abiertas = [];
  const navegadas = [];
  const clients = {
    matchAll: async () => ventanas.map((url) => ({
      url,
      focus: async () => {},
      navigate: async (u) => { navegadas.push(u); },
    })),
    openWindow: async (u) => { abiertas.push(u); },
    claim: () => {},
  };
  const self = {
    location: new URL(ORIGEN + "/firebase-messaging-sw.js"),
    addEventListener: (tipo, fn) => { listeners[tipo] = fn; },
    skipWaiting: () => {},
    clients,
    registration: { showNotification: async () => {} },
  };
  const ctx = {
    self,
    clients,
    URL,
    console,
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [], match: async () => null },
    importScripts: () => {},
    firebase: { initializeApp: () => {}, messaging: () => ({ onBackgroundMessage: () => {} }) },
  };
  vm.runInNewContext(codigo, ctx);
  return { listeners, abiertas, navegadas };
}

async function tocar(sw, url) {
  let espera;
  sw.listeners.notificationclick({
    notification: { close: () => {}, data: { url } },
    waitUntil: (p) => { espera = p; },
  });
  await espera;
}

test("SW — una URL de otro dominio abre la home de la app, no el sitio externo", async () => {
  const sw = cargarSW();
  await tocar(sw, "https://phishing.example/login");
  assert.deepEqual(sw.abiertas, [ORIGEN + "/"]);
});

test("SW — '//otro-sitio' y 'javascript:' también se neutralizan", async () => {
  for (const mala of ["//phishing.example/x", "javascript:alert(1)"]) {
    const sw = cargarSW();
    await tocar(sw, mala);
    assert.deepEqual(sw.abiertas, [ORIGEN + "/"], mala);
  }
});

test("SW — una ruta interna se abre normalmente", async () => {
  const sw = cargarSW();
  await tocar(sw, "/acme?screen=inbox");
  assert.deepEqual(sw.abiertas, [ORIGEN + "/acme?screen=inbox"]);
});

test("SW — con la app abierta, navega a la ruta interna en esa ventana", async () => {
  const sw = cargarSW({ ventanas: [ORIGEN + "/acme"] });
  await tocar(sw, "/acme?screen=inbox");
  assert.deepEqual(sw.navegadas, [ORIGEN + "/acme?screen=inbox"]);
  assert.deepEqual(sw.abiertas, []);
});
