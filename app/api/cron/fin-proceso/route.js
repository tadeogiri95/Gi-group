// GET /api/cron/fin-proceso — Cada 15 minutos (Tadeo, 01/11). Vercel Hobby
// solo corre crons una vez por día, así que lo llama Supabase con pg_cron +
// pg_net (migración 149), con el mismo CRON_SECRET que los demás crons.
// Avisa al celular cuando un proceso de una OT llegó a su hora de fin según
// el plan vivo y no está terminado (app/lib/finProcesoServidor.js).
import { NextResponse } from "next/server";
import { sbGetAll } from "../../../lib/sbHelpers";
import { getModulosEmpresa } from "../../../lib/planEnforcement";
import { revisarFinProcesos } from "../../../lib/finProcesoServidor";
import { logger } from "../../../lib/logger";
import { conMonitoreoCron } from "../../../lib/cronMonitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ejecutar(request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { data: empresas } = await sbGetAll("empresa?activa=eq.true&plan_activo=neq.free&select=id,slug&order=id.asc");
  let revisadas = 0, nuevos = 0, push = 0, errores = 0;
  for (const empresa of empresas) {
    try {
      // El plan de producción va con Proyectos
      const { modulos } = await getModulosEmpresa(empresa.id);
      if (!modulos.includes("proyectos")) continue;
      const r = await revisarFinProcesos(empresa);
      revisadas++;
      nuevos += r.nuevos;
      push += r.push;
    } catch (e) {
      errores++;
      logger.error(`[fin-proceso] empresa ${empresa.id}`, e);
    }
  }
  if (errores > 0 && revisadas === 0 && empresas.length > 0) {
    throw new Error(`fin-proceso: fallaron las ${errores} empresas`);
  }
  return NextResponse.json({ ok: true, empresas: revisadas, nuevos, push, errores });
}

export const GET = conMonitoreoCron("fin-proceso", ejecutar);
