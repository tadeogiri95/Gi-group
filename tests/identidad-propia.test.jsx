// tests/identidad-propia.test.jsx — Proyecto Firebase de Gypi y slug del piloto (ítem 33, F0-11/H6, H15).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { configFirebase } = await import("../app/lib/firebaseConfig.js");
const { GET: firebaseConfigJs } = await import("../app/firebase-config.js/route.js");
const { slugReservado, slugNuevo, rutaRenombrada } = await import("../app/lib/slugs.js");
const { generarSlugUnico } = await import("../app/lib/empresaSignup.js");
const { default: EmpresaNoEncontrada } = await import("../app/components/EmpresaNoEncontrada.jsx");

afterEach(() => cleanup());

const PROPIA = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "k", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "gypi.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "gypi", NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "gypi.app",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123", NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc",
};

test("configFirebase — usa el proyecto de las variables; si faltan, sigue el del piloto", () => {
  assert.equal(configFirebase(PROPIA).projectId, "gypi");
  assert.equal(configFirebase({}).projectId, "gi-group-app-676a0");
  assert.equal(configFirebase({ ...PROPIA, NEXT_PUBLIC_FIREBASE_APP_ID: "" }).projectId, "gi-group-app-676a0", "a medias no se usa");
});

test("/firebase-config.js — script para el service worker", async () => {
  const res = firebaseConfigJs();
  assert.match(res.headers.get("Content-Type"), /javascript/);
  const js = await res.text();
  const ctx = {};
  new Function("self", js)(ctx);
  assert.ok(ctx.GYPI_FIREBASE_CONFIG.projectId);
  assert.ok(ctx.GYPI_FIREBASE_CONFIG.messagingSenderId);
});

test("el service worker toma la configuración del servidor (no la tiene escrita)", async () => {
  const fs = await import("node:fs");
  const sw = fs.readFileSync(new URL("../public/firebase-messaging-sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes("importScripts('/firebase-config.js')"));
  assert.ok(!sw.includes("gi-group-app-676a0"), "sin el proyecto del piloto escrito a mano");
});

test("slugs — reservados y renombrados", () => {
  for (const s of ["gypi", "pricing", "terms", "superadmin", "Docs"]) assert.equal(slugReservado(s), true, s);
  assert.equal(slugReservado("acme"), false);
  assert.equal(slugNuevo("gypi"), "gi-group");
  assert.equal(slugNuevo("acme"), null);
  assert.equal(rutaRenombrada("/gypi/kiosco", "?legajo=7"), "/gi-group/kiosco?legajo=7");
  assert.equal(rutaRenombrada("/gypi"), "/gi-group");
  assert.equal(rutaRenombrada("/acme"), null);
});

test("generarSlugUnico — una empresa nueva no puede quedarse con 'gypi' ni con una ruta de la app", async () => {
  global.fetch = createFetchMock([{ match: (url) => url.includes("/rest/v1/empresa?slug="), respond: () => ({ status: 200, body: [] }) }]);
  assert.match(await generarSlugUnico("Gypi"), /^gypi-[a-z0-9]+$/);
  assert.match(await generarSlugUnico("Pricing"), /^pricing-[a-z0-9]+$/);
  assert.equal(await generarSlugUnico("Acme SA"), "acme-sa");
});

test("EmpresaNoEncontrada — la dirección vieja del piloto lleva a la nueva (con el resto del link)", () => {
  let destino = null;
  render(<EmpresaNoEncontrada slugActual="gypi" ubicacion={{ pathname: "/gypi/kiosco", search: "?legajo=7" }} irA={(u) => { destino = u; }} />);
  assert.equal(destino, "/gi-group/kiosco?legajo=7");
  assert.ok(screen.getByText(/nueva dirección/));
  cleanup();
  destino = null;
  render(<EmpresaNoEncontrada slugActual="otra" ubicacion={{ pathname: "/otra", search: "" }} irA={(u) => { destino = u; }} />);
  assert.equal(destino, null);
  assert.ok(screen.getByText("Empresa no encontrada"));
});
