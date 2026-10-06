import * as Sentry from "@sentry/nextjs";

// Sin NEXT_PUBLIC_SENTRY_DSN (variable de Vercel) Sentry queda apagado.
// Ajustado al plan gratuito de Sentry (F3-12): pocas trazas de performance y
// replays solo cuando hay un error.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),

  // Separa producción de las vistas previas de cada PR
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,

  debug: false,

  // Porcentaje de sesiones a rastrear para performance (0 = sin tracing de perf)
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,

  // Replays: nunca de sesiones normales; solo de las que tuvieron un error
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Datos de empleados: se tapan todos los textos e inputs en la grabación
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
});
