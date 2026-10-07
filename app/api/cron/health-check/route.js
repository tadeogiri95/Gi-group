import { NextResponse } from "next/server";
import { logger } from "../../../lib/logger";

import { conMonitoreoCron } from "../../../lib/cronMonitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Antes la precedencia del "||" con el "?" hacía ignorar NEXT_PUBLIC_APP_URL
  // y usar siempre la URL interna del deploy (que puede estar protegida).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

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
      // 200: el cron funcionó (detectó el problema y lo mandó a Sentry). Con 503
      // el monitoreo lo contaría como cron caído y se sumaría a la lista de atrasados.
      return NextResponse.json({ alerted: true, ...body });
    }

    return NextResponse.json({ ok: true, ts: body.ts });
  } catch (err) {
    logger.error("[cron/health-check] No se pudo alcanzar /api/health", err);
    return NextResponse.json({ error: "health unreachable" }, { status: 503 });
  }
}

// Registra cada corrida en cron_ejecuciones y avisa a Sentry si falla (F3-12)
export const GET = conMonitoreoCron("health-check", ejecutar);
