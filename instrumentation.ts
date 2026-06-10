// Next.js App Router instrumentation — punto de entrada para Sentry server-side.
// Se ejecuta una vez al arrancar el servidor, tanto en Node como en Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
