// GET /api/cron/costos-ot — Todos los días a las 9:30 UTC (6:30 en
// Argentina), después de la sincronización de las OT. Calcula el costo final
// de las OT que se cerraron y todavía no lo tienen (costo de OT, parte C;
// migración 167). Al abrir la OT también se calcula en el momento.
import { NextResponse } from "next/server";
import { procesarPendientes, faltaMigracionCostoFinal } from "../../../lib/costoFinalServidor";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const r = await procesarPendientes({ limite: 25 });
    if (r.errores > 0 && r.calculados === 0) throw new Error(`costos-ot: fallaron los ${r.errores} pendientes`);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    // Sin la 167 no hay nada que calcular
    if (faltaMigracionCostoFinal(err)) {
      logger.warn("[costos-ot] falta la migración 167");
      return NextResponse.json({ ok: true, falta_migracion: true });
    }
    throw err;
  }
}

export const GET = conMonitoreoCron("costos-ot", ejecutar);
