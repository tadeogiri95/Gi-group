/** @type {import('next').NextConfig} */

const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' requerido por Next.js (code splitting dinámico)
  // 'unsafe-inline' requerido por React inline styles y Tailwind
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // data: para favicons/logos en base64, blob: para exports PDF/CSV, https: para Supabase Storage
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Supabase REST + Realtime (wss), Firebase FCM, MercadoPago API
  [
    "connect-src 'self'",
    "https://*.supabase.co",
    "https://*.supabase.in",
    "wss://*.supabase.co",
    "https://fcm.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://www.googleapis.com",
    "https://api.mercadopago.com",
  ].join(" "),
  "media-src 'self' blob:",
  "worker-src 'self' blob:",   // Service Worker de la PWA
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Fuerza HTTPS por 2 años, incluye subdominios, apto para preload list
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Previene clickjacking — la app no debe embeberse en iframes externos
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Previene MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Controla qué se incluye en el header Referer
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restringe acceso a hardware sensible; geolocation permitida solo para fichaje GPS
  { key: "Permissions-Policy", value: "camera=(), microphone=(), interest-cohort=(), geolocation=(self)" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        // Aplica a todas las rutas (páginas y API)
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
