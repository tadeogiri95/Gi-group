// Structured logger — reemplaza console.log/error directo en API routes.
// En producción: suprime logs de debug, captura errores en Sentry.
// En desarrollo: pasa todo a console normalmente.

import * as Sentry from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";

type Extra = Record<string, unknown>;

function captureToSentry(err: unknown, msg: string, extra?: Extra) {
  if (!isProd) return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) return;
  try {
    const event = err instanceof Error ? err : new Error(msg);
    Sentry.captureException(event, { extra: { message: msg, ...extra } });
  } catch {
    // Sentry nunca debe romper el flujo de la app
  }
}

export const logger = {
  // Solo en desarrollo — debug / trazas de flujo
  debug: (...args: unknown[]) => {
    if (!isProd) console.log(...args);
  },

  // Info operacional — solo en desarrollo
  info: (...args: unknown[]) => {
    if (!isProd) console.log("[info]", ...args);
  },

  // Errores reales — siempre a console + Sentry en prod
  error: (msg: string, err?: unknown, extra?: Extra) => {
    const cause = err instanceof Error ? err.message : String(err ?? "");
    console.error(`[error] ${msg}${cause ? " — " + cause : ""}`, extra ?? "");
    captureToSentry(err, msg, extra);
  },

  // Advertencias — consola en dev, Sentry en prod
  warn: (msg: string, extra?: Extra) => {
    if (!isProd) {
      console.warn(`[warn] ${msg}`, extra ?? "");
    } else {
      if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) return;
      try { Sentry.captureMessage(msg, { level: "warning", extra }); } catch {}
    }
  },
};
