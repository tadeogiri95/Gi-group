import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateCsrf, generateCsrfToken } from "./app/lib/csrf";

// Única fuente de verdad para los security headers — en Next.js 16 este
// archivo (proxy.ts) es el middleware activo. Anteriormente next.config.mjs
// también definía headers() con un CSP ligeramente distinto; como ambos se
// aplican al mismo response, los valores de éste archivo siempre ganaban en
// las claves que se solapan (confirmado con curl), dejando ese otro CSP sin
// efecto real. Se consolidó todo aquí para evitar que vuelvan a divergir.

export function proxy(request: NextRequest) {
  // ── CSRF validation on mutating API requests ────────────────────────────
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;
  }

  const res = NextResponse.next();

  // ── Content-Security-Policy ──────────────────────────────────────────────
  // 'unsafe-eval' requerido por Next.js (code splitting dinámico).
  // 'unsafe-inline' requerido por React inline styles y los estilos hidratados.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // data: para favicons/logos en base64, blob: para exports PDF/CSV
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    [
      "connect-src 'self'",
      supabaseUrl,
      "https://*.supabase.in",
      "wss://*.supabase.co",
      "https://fcm.googleapis.com",
      "https://firebaseinstallations.googleapis.com",
      "https://www.googleapis.com",
      "https://api.mercadopago.com",
      "https://*.tile.openstreetmap.org", // mapa de geolocalización (Leaflet)
    ].filter(Boolean).join(" "),
    "media-src 'self' blob:",
    "worker-src 'self' blob:", // Service Worker de la PWA
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);

  // ── Otros headers de seguridad ───────────────────────────────────────────
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), interest-cohort=(), geolocation=(self)");

  // ── CSRF cookie (set if not already present) ────────────────────────────
  if (!request.cookies.get("gypi_csrf")?.value) {
    const isProd = process.env.NODE_ENV === "production";
    res.cookies.set({
      name: "gypi_csrf",
      value: generateCsrfToken(),
      httpOnly: false, // JS must read it to send in header
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60, // 24h
    });
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|firebase-messaging-sw.js).*)",
  ],
};
