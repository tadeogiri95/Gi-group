/** @type {import('next').NextConfig} */
import { withSentryConfig } from "@sentry/nextjs";

// Los security headers (CSP, HSTS, X-Frame-Options, etc.) viven en proxy.ts
// — es el middleware activo en Next.js 16 y siempre gana sobre headers()
// para las claves que se solapan. Mantener ambos generaba dos fuentes de
// verdad divergentes (ver comentario en proxy.ts).

const nextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Sube source maps a Sentry en cada deploy para stack traces legibles
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Oculta los source maps del bundle público
  hideSourceMaps: true,
  // Desactiva el logger de Sentry en runtime (reduce ruido en Vercel logs)
  disableLogger: true,
  // Tunneling evita que bloqueadores de anuncios corten los eventos
  tunnelRoute: "/monitoring",
});
