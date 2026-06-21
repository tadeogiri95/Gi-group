// Double-submit cookie CSRF protection.
//
// How it works:
//   1. proxy.ts sets a random `gypi_csrf` cookie on every response (if not already present)
//   2. Mutating requests (POST/PATCH/DELETE) must include a `x-csrf-token` header
//      whose value matches the cookie
//   3. Attacker sites can't read the cookie (SameSite=Lax + HttpOnly=false so JS can read it)
//      but the CSRF page won't have the cookie value to send in the header
//
// Exempt endpoints:
//   - /api/billing/webhook (external service, uses HMAC)
//   - /api/cron/* (internal, uses bearer tokens)
//   - /api/health (GET only)
//   - /api/registro-empresa (pre-login, no session cookie to protect)
//   - /api/unirse (pre-login)

import { NextResponse } from "next/server";

const EXEMPT_PATHS = [
  "/api/billing/webhook",
  "/api/cron/",
  "/api/health",
  "/api/registro-empresa",
  "/api/unirse",
  "/api/verificar-email",
  "/api/superadmin/",
  "/api/login-empresa",
  "/api/logout",
  "/api/refresh-token",
  "/api/recuperar-password",
  "/api/resetear-password",
];

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Validate CSRF on mutating requests using a layered approach:
 *   1. If x-csrf-token header matches gypi_csrf cookie → pass (double-submit)
 *   2. If Origin header matches our host → pass (same-origin check)
 *   3. Otherwise → block
 *
 * @param {import("next/server").NextRequest} request
 * @returns {NextResponse | null}
 */
export function validateCsrf(request) {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const path = request.nextUrl.pathname;
  if (EXEMPT_PATHS.some(p => path.startsWith(p))) return null;

  // Layer 1: double-submit cookie
  const cookieToken = request.cookies.get("gypi_csrf")?.value;
  const headerToken = request.headers.get("x-csrf-token");
  if (cookieToken && headerToken && cookieToken === headerToken) return null;

  // Layer 2: Origin header check (browsers always send this on POST)
  const origin = request.headers.get("origin");
  if (origin) {
    const requestHost = request.nextUrl.host;
    try {
      const originHost = new URL(origin).host;
      if (originHost === requestHost) return null;
    } catch { /* invalid origin */ }
  }

  // Layer 3: Referer fallback (some old browsers)
  const referer = request.headers.get("referer");
  if (referer) {
    const requestHost = request.nextUrl.host;
    try {
      const refererHost = new URL(referer).host;
      if (refererHost === requestHost) return null;
    } catch { /* invalid referer */ }
  }

  return NextResponse.json(
    { error: "CSRF: solicitud bloqueada por seguridad" },
    { status: 403 }
  );
}

/**
 * Generate a random CSRF token.
 * @returns {string}
 */
export function generateCsrfToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
