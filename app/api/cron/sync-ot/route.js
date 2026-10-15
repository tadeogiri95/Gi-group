// /api/cron/sync-ot — Trae las OT nuevas de la planilla de cada empresa,
// todas las mañanas, sin que nadie tenga que tocar "Sincronizar". Después
// copia los artículos y el stock de la planilla MRP (Stock, parte 13).

import { NextResponse } from "next/server";
import { syncTodas } from "../../../lib/syncOt";
import { syncStockTodas } from "../../../lib/syncStock";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ejecutar(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const results = await syncTodas();
    const conError = results.filter(r => r.error);
    if (conError.length) logger.error("[sync-ot] Empresas con error", new Error(conError.map(r => `${r.empresa_id}: ${r.error}`).join("; ")));
    // El stock va aparte: si falla, las OT ya quedaron sincronizadas
    let stock = [];
    try {
      stock = await syncStockTodas();
      const stockError = stock.filter(r => r.error);
      if (stockError.length) logger.error("[sync-ot] Stock con error", new Error(stockError.map(r => `${r.empresa_id}: ${r.error}`).join("; ")));
    } catch (e) {
      logger.error("[sync-ot] Error sincronizando stock", e);
    }
    return NextResponse.json({ ok: true, empresas: results.length, conError: conError.length, stock: stock.length });
  } catch (e) {
    logger.error("[sync-ot] Error sincronizando OT", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const GET = conMonitoreoCron("sync-ot", ejecutar);
