// tests/helpers/withNextCookies.js — Simula el contexto de cookies de Next.js
// para poder testear route handlers que usen `cookies()` de `next/headers`
// fuera del runtime de Next.js.
//
// Uso:
//   const res = await withNextCookies("gypi_superadmin=token123", () => GET(req));

import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

// Asegurar que globalThis.AsyncLocalStorage existe antes de que Next.js lo
// evalúe (Next.js usa un FakeAsyncLocalStorage si no lo encuentra).
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}

const require = createRequire(import.meta.url);

// Importar las instancias de async storage de Next.js (CJS)
const { workAsyncStorageInstance } = require("next/dist/server/app-render/work-async-storage-instance");
const { workUnitAsyncStorageInstance } = require("next/dist/server/app-render/work-unit-async-storage-instance");
const { RequestCookies } = require("next/dist/compiled/@edge-runtime/cookies");

/**
 * Ejecuta `fn` dentro de un contexto simulado de Next.js request con las
 * cookies indicadas. Esto permite que `cookies()` de `next/headers` funcione.
 *
 * @param {string} cookieString — Valor del header Cookie (e.g. "a=1; b=2")
 * @param {() => Promise<Response>} fn — Función a ejecutar (normalmente la llamada al handler)
 */
export function withNextCookies(cookieString, fn) {
  const cookieHeader = new Headers({ cookie: cookieString || "" });
  const rc = new RequestCookies(cookieHeader);

  const workStore = { route: "/test", forceStatic: false };
  const workUnitStore = { type: "request", cookies: rc, phase: "render" };

  return workAsyncStorageInstance.run(workStore, () => {
    return workUnitAsyncStorageInstance.run(workUnitStore, fn);
  });
}
