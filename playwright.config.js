// playwright.config.js — Smoke test E2E sobre el dev server local.
// No requiere Supabase real: las rutas de API se interceptan con
// page.route() en los specs (ver e2e/smoke.spec.js).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // Teléfono con el permiso de ubicación dado (F1-17): sin esto el fichaje
    // esperaba el GPS hasta agotar el tiempo y el test fallaba fuera de CI.
    geolocation: { latitude: -31.4201, longitude: -64.1888, accuracy: 20 },
    permissions: ["geolocation"],
    // page.route() no intercepta lo que pide el service worker (ítem 21): sin
    // bloquearlo, /api/me y /api/empresa irían al servidor real.
    serviceWorkers: "block",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
