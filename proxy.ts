import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const res = NextResponse.next();

  // ── Content-Security-Policy ──────────────────────────────────────────────
  // Next.js requiere unsafe-inline para scripts de hidratación.
  // connect-src restringe a dónde puede conectarse el cliente.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    [
      "connect-src 'self'",
      supabaseUrl,
      "wss://*.supabase.co",
      "https://api.anthropic.com",
      "https://fcm.googleapis.com",
      "https://firebaseinstallations.googleapis.com",
      "https://api.mercadopago.com",
    ].filter(Boolean).join(" "),
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);

  // ── Otros headers de seguridad ───────────────────────────────────────────
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|firebase-messaging-sw.js).*)",
  ],
};
