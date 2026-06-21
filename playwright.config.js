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
