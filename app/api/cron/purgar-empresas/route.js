// GET /api/cron/purgar-empresas — Todos los días 05:30 UTC.
// Borra para siempre las empresas dadas de baja hace más de 30 días:
// primero sus archivos de Storage, después todas sus filas (F6-01, ítem 28).
import { NextResponse } from "next/server";
import { sbGet } from "../../../lib/sbHelpers";
import { purgarEmpresa, DIAS_RETENCION } from "../../../lib/bajaCuenta";
import { logAudit } from "../../../lib/audit";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const limite = new Date(Date.now() - DIAS_RETENCION * 86400000).toISOString();
  const vencidas = (await sbGet(
    `empresa?activa=eq.false&baja_solicitada_en=lt.${limite}&select=id,nombre,baja_solicitada_en&order=baja_solicitada_en.asc&limit=20`
  )) || [];

  let purgadas = 0;
  const errores = [];
  for (const emp of vencidas) {
    try {
      const r = await purgarEmpresa(emp.id);
      purgadas++;
      // El audit_log de la empresa se borra con ella: queda registro sin empresa_id
      logAudit({ accion: "purgar_empresa", entidad: "empresa", entidad_id: emp.id, datos_antes: { baja_solicitada_en: emp.baja_solicitada_en }, datos_despues: { archivos: r.archivos, filas: r.filas } });
    } catch (e) {
      errores.push(emp.id);
      logger.error(`[purgar-empresas] ${emp.id}`, e);
    }
  }
  if (errores.length > 0) {
    return NextResponse.json({ ok: false, purgadas, errores }, { status: 500 });
  }
  return NextResponse.json({ ok: true, purgadas });
}

export const GET = conMonitoreoCron("purgar-empresas", ejecutar);
