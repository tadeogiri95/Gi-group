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
  // ── ad-frame.html: documento aislado para el script de Google AdSense
  // (ver AdSlot.jsx) — necesita poder ser embebido por nuestras propias
  // páginas (frame-ancestors/X-Frame-Options de abajo lo prohibirían) y un
  // CSP propio que permita cargar adsbygoogle.js, no el de la app. No
  // necesita CSRF ni el resto de los headers de seguridad de la app: es un
  // archivo estático sin acceso a cookies de sesión ni a nuestra API.
  if (request.nextUrl.pathname === "/ad-frame.html") {
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://www.googletagservices.com https://www.google.com https://www.gstatic.com https://*.adtrafficquality.google",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com https://*.adtrafficquality.google",
      "connect-src 'self' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://*.adtrafficquality.google",
      "frame-ancestors 'self'",
    ].join("; "));
    return res;
  }

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
    // pagead2/googletagservices/google/gstatic: Google AdSense (plan Free,
    // ver app/components/AdSlot.jsx). Acotado a estos dominios, no wildcard.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://www.googletagservices.com https://www.google.com https://www.gstatic.com https://*.adtrafficquality.google",
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
      "https://pagead2.googlesyndication.com", // Google AdSense
      "https://googleads.g.doubleclick.net",
      "https://*.adtrafficquality.google", // verificación anti-fraude de AdSense (sodar) — confirmado con tráfico real en preview
    ].filter(Boolean).join(" "),
    "media-src 'self' blob:",
    "worker-src 'self' blob:", // Service Worker de la PWA
    // Google AdSense sirve los anuncios dentro de un iframe — sin estos
    // dominios ningún anuncio renderiza. 'self' es para nuestro propio
    // /ad-frame.html (ver AdSlot.jsx), que aísla el script de Google en su
    // propio document/window para que no pueda trabar el scroll del shell.
    "frame-src 'self' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com https://*.adtrafficquality.google",
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
