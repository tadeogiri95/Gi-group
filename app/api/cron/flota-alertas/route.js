// GET /api/cron/flota-alertas — Todos los días a las 10:00 UTC (7:00 en
// Argentina). Revisa la flota de cada empresa con plan vigente y Flota
// (Mantenimiento, parte 30; migración 128): papeles, licencia del chofer,
// revisiones por checklist y service. Cuando aparece algo nuevo vencido o por
// vencer, avisa al celular del responsable del vehículo y manda a gerencia y
// Administración un resumen. Lo que ya se avisó no se repite (vehiculos.
// aviso_firma). Solo avisa: no bloquea nada.
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { getModulosEmpresa } from "../../../lib/planEnforcement";
import { revisarFlota } from "../../../lib/flotaAlertasServidor";
import { hoyArg } from "../../../lib/dates";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const hoy = hoyArg();
  const { data: empresas } = await sbGetAll("empresa?activa=eq.true&plan_activo=neq.free&select=id,slug&order=id.asc");
  let revisadas = 0, avisados = 0, push = 0, errores = 0;
  for (const empresa of empresas) {
    try {
      // Flota va con el módulo de OT (proyectos)
      const { modulos } = await getModulosEmpresa(empresa.id);
      if (!modulos.includes("proyectos")) continue;
      const r = await revisarFlota(empresa, hoy);
      if (!r.vehiculos) continue;
      revisadas++;
      avisados += r.avisados;
      push += r.push;
    } catch (e) {
      errores++;
      logger.error(`[flota-alertas] empresa ${empresa.id}`, e);
    }
  }
  if (errores > 0 && revisadas === 0 && empresas.length > 0) {
    throw new Error(`flota-alertas: fallaron las ${errores} empresas`);
  }
  return NextResponse.json({ ok: true, hoy, empresas: revisadas, avisados, push, errores });
}

export const GET = conMonitoreoCron("flota-alertas", ejecutar);
