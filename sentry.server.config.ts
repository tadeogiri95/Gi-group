import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  debug: false,

  // Captura el 20% de transacciones de servidor en producción
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 0,
});
