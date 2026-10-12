// /api/cron/sync-ot — Trae las OT nuevas de la planilla de cada empresa,
// todas las mañanas, sin que nadie tenga que tocar "Sincronizar".

import { NextResponse } from "next/server";
import { syncTodas } from "../../../lib/syncOt";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const results = await syncTodas();
    const conError = results.filter(r => r.error);
    if (conError.length) logger.error("[sync-ot] Empresas con error", new Error(conError.map(r => `${r.empresa_id}: ${r.error}`).join("; ")));
    return NextResponse.json({ ok: true, empresas: results.length, conError: conError.length });
  } catch (e) {
    logger.error("[sync-ot] Error sincronizando OT", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const GET = conMonitoreoCron("sync-ot", ejecutar);
