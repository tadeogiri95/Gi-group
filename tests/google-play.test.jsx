// tests/google-play.test.jsx — App de Google Play (TWA) sin precios (ítem 34, D12/D14).
import "./helpers/domSetup.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { assetLinks } = await import("../app/lib/assetLinks.js");
const { GET: assetlinksJson } = await import("../app/.well-known/assetlinks.json/route.js");
const { esInicioAndroid, marcarSiEsAppAndroid, esAppAndroid } = await import("../app/lib/appAndroid.js");
const { destinoAppInstalada } = await import("../app/lib/ultimaEmpresa.js");
const { default: BillingScreen } = await import("../app/components/BillingScreen.jsx");
const { default: IngresoApp } = await import("../app/components/IngresoApp.jsx");

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const HUELLA = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(":");

test("assetLinks — vincula el paquete con sus huellas; sin datos válidos no publica nada", () => {
  const [link] = assetLinks({ ANDROID_PACKAGE_NAME: "app.gypi.twa", ANDROID_SHA256_FINGERPRINTS: `${HUELLA}, ${HUELLA.toLowerCase()}, mala` });
  assert.deepEqual(link.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(link.target.package_name, "app.gypi.twa");
  assert.deepEqual(link.target.sha256_cert_fingerprints, [HUELLA, HUELLA], "pasa a mayúsculas y descarta lo inválido");
  assert.deepEqual(assetLinks({}), []);
  assert.deepEqual(assetLinks({ ANDROID_PACKAGE_NAME: "nopaquete", ANDROID_SHA256_FINGERPRINTS: HUELLA }), []);
  assert.deepEqual(assetLinks({ ANDROID_PACKAGE_NAME: "app.gypi.twa", ANDROID_SHA256_FINGERPRINTS: "AB:CD" }), []);
});

test("/.well-known/assetlinks.json — responde JSON", async () => {
  const res = assetlinksJson();
  assert.match(res.headers.get("Content-Type"), /json/);
  assert.ok(Array.isArray(await res.json()));
});

test("appAndroid — reconoce la app de Play y lo recuerda", () => {
  assert.equal(esInicioAndroid("?source=twa", ""), true);
  assert.equal(esInicioAndroid("", "android-app://app.gypi.twa/"), true);
  assert.equal(esInicioAndroid("?source=pwa", "https://google.com"), false);
  assert.equal(esAppAndroid(), false);
  assert.equal(marcarSiEsAppAndroid("?source=twa", ""), true);
  assert.equal(esAppAndroid(), true, "en las páginas siguientes (sin ?source) sigue sabiendo");
});

test("destinoAppInstalada — la app de Play también abre directo en la empresa", () => {
  assert.equal(destinoAppInstalada("?source=twa", false, { slug: "acme" }), "/acme");
  assert.equal(destinoAppInstalada("?source=twa", false, null), null);
});

test("BillingScreen — en la app de Play no muestra precios ni cobra", () => {
  marcarSiEsAppAndroid("?source=twa", "");
  render(<BillingScreen onClose={() => {}} />);
  assert.ok(screen.getByText(/se gestiona desde la web/));
  assert.equal(screen.queryByText(/\$/), null);
});

test("IngresoApp — busca la empresa por código y entra", async () => {
  let destino = null;
  global.fetch = async (url) => new Response(JSON.stringify({ id: "e" }), { status: String(url).includes("slug=acme") ? 200 : 404 });
  render(<IngresoApp irA={(u) => { destino = u; }} />);
  fireEvent.change(screen.getByLabelText("Código de tu empresa"), { target: { value: "otra" } });
  fireEvent.click(screen.getByText("Entrar"));
  assert.ok(await screen.findByText(/No encontramos ninguna empresa/));
  fireEvent.change(screen.getByLabelText("Código de tu empresa"), { target: { value: "https://gypi.app/acme" } });
  fireEvent.click(screen.getByText("Entrar"));
  await waitFor(() => assert.equal(destino, "/acme"));
});
