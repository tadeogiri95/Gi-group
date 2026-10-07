import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
  // Separa producción de las vistas previas de cada PR (F3-12)
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,

  debug: false,

  // 5% de transacciones en producción: alcanza para ver tendencias sin gastar el cupo gratuito
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
});
