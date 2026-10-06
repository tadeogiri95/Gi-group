// app/api/health — Verificación del estado del servidor y vars de entorno requeridas.
// Úsalo desde Vercel, UptimeRobot o cualquier monitor externo.
import { NextResponse } from "next/server";
import { cronsAtrasados } from "../../lib/cronMonitor";

const REQUIRED_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "JWT_SECRET",
];

const OPTIONAL_VARS = [
  "RESEND_API_KEY",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_SERVICE_ACCOUNT_B64",
  "SUPERADMIN_SECRET",
  "CRON_SECRET",
];

export async function GET(request) {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

  let db = "ok";
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/empresa?select=id&limit=1`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) db = `error_${r.status}`;
    } catch (e) {
      db = `timeout_or_unreachable`;
    }
  } else {
    db = "not_configured";
  }

  // Crons (F3-12): si alguno no corrió bien dentro de su ventana, el estado
  // pasa a "degraded" y el monitor externo de uptime avisa. Si la tabla todavía
  // no existe (migración 072 pendiente), no se evalúa.
  let crons = "sin_datos";
  let atrasados = [];
  if (db === "ok") {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/cron_ejecuciones?select=nombre,ultima_ok`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        atrasados = cronsAtrasados(await r.json());
        crons = atrasados.length > 0 ? "atrasados" : "ok";
      }
    } catch {
      // sin datos de crons: no cambia el estado
    }
  }

  const status = missing.length > 0 || db !== "ok" || crons === "atrasados" ? "degraded" : "ok";

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isAuthed = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (isAuthed) {
    const warnings = OPTIONAL_VARS.filter((v) => !process.env[v]);
    return NextResponse.json(
      { status, db, crons, crons_atrasados: atrasados.length > 0 ? atrasados : undefined, env: { missing, warnings: warnings.length > 0 ? warnings : undefined }, ts: new Date().toISOString() },
      { status: status === "ok" ? 200 : 503 }
    );
  }

  return NextResponse.json(
    { status, crons, ts: new Date().toISOString() },
    { status: status === "ok" ? 200 : 503 }
  );
}
