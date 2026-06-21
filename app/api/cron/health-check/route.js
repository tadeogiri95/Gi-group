import { NextResponse } from "next/server";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await res.json();

    if (body.status !== "ok") {
      logger.error("[cron/health-check] Sistema degradado", new Error(`health=${body.status} db=${body.db}`), {
        health: body,
      });
      return NextResponse.json({ alerted: true, ...body }, { status: 503 });
    }

    return NextResponse.json({ ok: true, ts: body.ts });
  } catch (err) {
    logger.error("[cron/health-check] No se pudo alcanzar /api/health", err);
    return NextResponse.json({ error: "health unreachable" }, { status: 503 });
  }
}
