// GET /api/cron/resumen-semanal — Lunes 11:00 UTC (8:00 en Argentina).
// Manda al dueño de cada empresa con plan vigente (trial o pago) el resumen
// de la semana anterior: horas por OT, tiempo muerto por causa y ausencias
// (D10, ítem 31). Se desactiva por empresa con empresa.resumen_semanal=false.
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { sendResumenSemanal } from "../../../lib/email";
import { resumenVacio } from "../../../lib/resumenSemanal";
import { resumenDeEmpresa } from "../../../lib/resumenSemanalServidor";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function empresasDestino() {
  const base = "empresa?activa=eq.true&plan_activo=neq.free&admin_email=not.is.null&select=id,nombre,nombre_corto,slug,admin_email,timezone&order=id.asc";
  try {
    return (await sbGetAll(`${base}&resumen_semanal=not.is.false`)).data;
  } catch (e) {
    // Sin la migración 077 la columna no existe: se manda a todas (el default es activado)
    if (!String(e?.message || "").includes("resumen_semanal")) throw e;
    return (await sbGetAll(base)).data;
  }
}

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const empresas = await empresasDestino();
  let enviados = 0, vacios = 0, errores = 0;
  // De a una: cada empresa son 5 consultas y no hay apuro
  for (const empresa of empresas) {
    try {
      const resumen = await resumenDeEmpresa(empresa);
      if (resumenVacio(resumen)) { vacios++; continue; }
      const envio = await sendResumenSemanal({
        to: empresa.admin_email,
        empresa: empresa.nombre_corto || empresa.nombre,
        slug: empresa.slug,
        resumen,
        empresaId: empresa.id,
      });
      // Resend no tira: devuelve { error } (y sin RESEND_API_KEY no manda nada)
      if (!envio || envio.error) throw new Error(envio?.error?.message || "email no configurado");
      enviados++;
    } catch (e) {
      errores++;
      logger.error(`[resumen-semanal] empresa ${empresa.id}`, e);
    }
  }
  if (errores > 0 && enviados === 0 && empresas.length > 0) {
    throw new Error(`resumen-semanal: fallaron las ${errores} empresas`);
  }
  return NextResponse.json({ ok: true, empresas: empresas.length, enviados, vacios, errores });
}

export const GET = conMonitoreoCron("resumen-semanal", ejecutar);
