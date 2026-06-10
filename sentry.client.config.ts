import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Muestra el error overlay en desarrollo
  debug: false,

  // Porcentaje de sesiones a rastrear para performance (0 = sin tracing de perf)
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,

  // Captura replays solo en producción — 10% normal, 100% si hay error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // No capturar input de contraseñas
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  ],
});
