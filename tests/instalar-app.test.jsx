// tests/instalar-app.test.jsx — Ofrecer instalar Gypi en el celular (PWA):
// botón Instalar en Android, pasos en iPhone, "Ahora no" por 7 días.
import "./helpers/domSetup.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const lib = await import("../app/lib/instalarApp.js");
const { TarjetaInstalar, BotonInstalar } = await import("../app/components/InstalarApp.jsx");

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

function celular(ua) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => ua });
}
/** Simula que Chrome avisa que se puede instalar. */
function avisoChrome(outcome = "accepted") {
  const e = new window.Event("beforeinstallprompt", { cancelable: true });
  e.prompt = async () => { e.abierto = true; };
  e.userChoice = Promise.resolve({ outcome });
  act(() => { window.dispatchEvent(e); });
  return e;
}

beforeEach(() => { localStorage.clear(); celular(PC); });
afterEach(() => { cleanup(); window.dispatchEvent(new window.Event("appinstalled")); localStorage.clear(); });

test("sistemaCelular — Android, iPhone, iPad que dice ser Mac, y computadora", () => {
  assert.equal(lib.sistemaCelular(ANDROID), "android");
  assert.equal(lib.sistemaCelular(IPHONE), "ios");
  assert.equal(lib.sistemaCelular("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5), "ios");
  assert.equal(lib.sistemaCelular("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0), null);
  assert.equal(lib.sistemaCelular(PC), null);
});

test("queOfrecer — nada en la computadora, instalada o en la app de Play; Android solo con aviso salvo el botón fijo", () => {
  const base = { instalada: false, appPlay: false, hayAviso: false };
  assert.equal(lib.queOfrecer({ ...base, sistema: null }), null);
  assert.equal(lib.queOfrecer({ ...base, sistema: "ios" }), "ios");
  assert.equal(lib.queOfrecer({ ...base, sistema: "ios", instalada: true }), null);
  assert.equal(lib.queOfrecer({ ...base, sistema: "android" }), null);
  assert.equal(lib.queOfrecer({ ...base, sistema: "android", hayAviso: true }), "android");
  assert.equal(lib.queOfrecer({ ...base, sistema: "android", hayAviso: true, appPlay: true }), null);
  assert.equal(lib.queOfrecer({ ...base, sistema: "android", fijo: true }), "android-menu");
});

test("posponer — 'Ahora no' esconde la tarjeta 7 días", () => {
  const ahora = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(lib.estaPospuesto(ahora), false);
  lib.posponer(ahora);
  assert.equal(lib.estaPospuesto(ahora + 6 * 86400000), true);
  assert.equal(lib.estaPospuesto(ahora + 8 * 86400000), false);
});

test("TarjetaInstalar — en la computadora no aparece", () => {
  render(<TarjetaInstalar />);
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null);
});

test("TarjetaInstalar — iPhone: muestra los pasos de Compartir → Agregar a inicio; Ahora no la esconde", () => {
  celular(IPHONE);
  render(<TarjetaInstalar />);
  screen.getByText("📲 Instalá Gypi en tu celular");
  screen.getByText("Agregar a inicio");
  fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null);
  assert.equal(lib.estaPospuesto(), true);
});

test("TarjetaInstalar — Android: aparece cuando Chrome avisa y el botón abre la ventana del teléfono", async () => {
  celular(ANDROID);
  render(<TarjetaInstalar />);
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null, "sin aviso de Chrome no hay botón posible");
  const e = avisoChrome("accepted");
  assert.equal(e.defaultPrevented, true, "no sale la barrita propia de Chrome");
  await act(async () => { fireEvent.click(screen.getByText("Instalar")); });
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null);
  assert.equal(e.abierto, true);
  assert.equal(lib.estaPospuesto(), true, "instalada: no se vuelve a ofrecer");
});

test("TarjetaInstalar — no aparece si ya se abre como app ni dentro de la app de Google Play", () => {
  celular(IPHONE);
  Object.defineProperty(window.navigator, "standalone", { configurable: true, get: () => true });
  render(<TarjetaInstalar />);
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null);
  cleanup();
  Object.defineProperty(window.navigator, "standalone", { configurable: true, get: () => undefined });
  celular(ANDROID);
  localStorage.setItem("gypi_app_android", "1");
  render(<TarjetaInstalar />);
  avisoChrome();
  assert.equal(screen.queryByLabelText("Instalar Gypi"), null);
});

test("BotonInstalar — aparece aunque se haya tocado Ahora no; en Android sin aviso explica el menú ⋮", () => {
  celular(ANDROID);
  lib.posponer();
  render(<BotonInstalar />);
  fireEvent.click(screen.getByRole("button", { name: "📲 Instalar en el celular" }));
  screen.getByText("Instalar aplicación");
});
