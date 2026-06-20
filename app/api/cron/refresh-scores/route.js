// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/refresh-scores — Refresca la MATERIALIZED VIEW v_scores_empleados
//
// La migración 040 convirtió v_scores_empleados en MATERIALIZED VIEW y creó
// refresh_scores_empleados(), pero nada la llamaba: los rankings del
// dashboard de gerencia (score_em, score_nc) quedaron congelados con los
// datos del momento en que se materializó la vista por primera vez.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { sbRpc } from "../../../lib/sbHelpers";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    await sbRpc("refresh_scores_empleados");
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error("[refresh-scores] Error refrescando v_scores_empleados", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
