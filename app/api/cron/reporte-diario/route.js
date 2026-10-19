// GET /api/cron/reporte-diario — Todos los días a las 2:00 UTC (23:00 en
// Argentina). Manda al dueño de cada empresa con plan vigente el reporte del
// día de producción e instalación (seguimiento de OT por escaneo, parte 26).
// Si ese día no hubo escaneos, etapas cerradas ni reportes de instalación,
// no manda nada. El mismo reporte se ve en Reportes → Del día.
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sendReporteDiario } from "../../../lib/email";
import { reporteVacio, fechaDelReporte } from "../../../lib/reporteDiario";
import { reporteDiarioDeEmpresa } from "../../../lib/reporteDiarioServidor";
import { getModulosEmpresa } from "../../../lib/planEnforcement";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const fecha = fechaDelReporte();
  const { data: empresas } = await sbGetAll("empresa?activa=eq.true&plan_activo=neq.free&admin_email=not.is.null&select=id,nombre,nombre_corto,slug,admin_email&order=id.asc");
  let enviados = 0, vacios = 0, errores = 0;
  for (const empresa of empresas) {
    try {
      // Sin Producción en el plan no hay escaneos ni instalación que reportar
      const { modulos } = await getModulosEmpresa(empresa.id);
      if (!modulos.includes("actividad")) { vacios++; continue; }
      const reporte = await reporteDiarioDeEmpresa(empresa.id, fecha);
      if (reporteVacio(reporte)) { vacios++; continue; }
      const envio = await sendReporteDiario({
        to: empresa.admin_email,
        empresa: empresa.nombre_corto || empresa.nombre,
        slug: empresa.slug,
        reporte,
        empresaId: empresa.id,
      });
      if (!envio || envio.error) throw new Error(envio?.error?.message || "email no configurado");
      enviados++;
    } catch (e) {
      errores++;
      logger.error(`[reporte-diario] empresa ${empresa.id}`, e);
    }
  }
  if (errores > 0 && enviados === 0 && empresas.length > 0) {
    throw new Error(`reporte-diario: fallaron las ${errores} empresas`);
  }
  return NextResponse.json({ ok: true, fecha, empresas: empresas.length, enviados, vacios, errores });
}

export const GET = conMonitoreoCron("reporte-diario", ejecutar);
