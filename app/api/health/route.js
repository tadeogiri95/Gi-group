// app/api/health — Verificación del estado del servidor y vars de entorno requeridas.
// Úsalo desde Vercel, UptimeRobot o cualquier monitor externo.
import { NextResponse } from "next/server";

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

  const status = missing.length > 0 || db !== "ok" ? "degraded" : "ok";

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isAuthed = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (isAuthed) {
    const warnings = OPTIONAL_VARS.filter((v) => !process.env[v]);
    return NextResponse.json(
      { status, db, env: { missing, warnings: warnings.length > 0 ? warnings : undefined }, ts: new Date().toISOString() },
      { status: status === "ok" ? 200 : 503 }
    );
  }

  return NextResponse.json(
    { status, ts: new Date().toISOString() },
    { status: status === "ok" ? 200 : 503 }
  );
}
