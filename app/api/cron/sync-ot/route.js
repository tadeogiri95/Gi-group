// /api/cron/sync-ot — Trae las OT nuevas de la planilla de cada empresa,
// todas las mañanas, sin que nadie tenga que tocar "Sincronizar". A la vez
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
  // OT y stock van a la vez y cada una por su lado: antes el stock esperaba a
  // que terminaran las OT y, si estas tardaban, se quedaba sin tiempo (60 s).
  // Si una falla, la otra igual queda sincronizada.
  const [ot, stock] = await Promise.allSettled([syncTodas(), syncStockTodas()]);
  if (stock.status === "fulfilled") {
    const stockError = stock.value.filter(r => r.error);
    if (stockError.length) logger.error("[sync-ot] Stock con error", new Error(stockError.map(r => `${r.empresa_id}: ${r.error}`).join("; ")));
  } else {
    logger.error("[sync-ot] Error sincronizando stock", stock.reason);
  }
  if (ot.status === "rejected") {
    logger.error("[sync-ot] Error sincronizando OT", ot.reason);
    return NextResponse.json({ error: ot.reason?.message }, { status: 500 });
  }
  const results = ot.value;
  const conError = results.filter(r => r.error);
  if (conError.length) logger.error("[sync-ot] Empresas con error", new Error(conError.map(r => `${r.empresa_id}: ${r.error}`).join("; ")));
  return NextResponse.json({ ok: true, empresas: results.length, conError: conError.length, stock: stock.status === "fulfilled" ? stock.value.length : 0 });
}

export const GET = conMonitoreoCron("sync-ot", ejecutar);
