// /api/proyectos/sync-csv
// Descarga el CSV de la planilla de OT (config_sistema clave proyectos_csv_url)
// y hace upsert de proyectos por OT (empresa_id, ot). La lógica está en
// app/lib/syncOt.js.
//
// POST sin x-cron-secret → requiere JWT y sincroniza la empresa del token.
//   - gerencial/administrativo: siempre (botón Sincronizar).
//   - el resto (el empleado que busca o escanea una OT que la app no tiene):
//     solo si la última sincronización fue hace más de 5 minutos.
// POST con x-cron-secret → sincroniza todas las empresas que tienen URL configurada.

import { NextResponse } from "next/server";
import { validarToken } from "../../../lib/auth";
import { logger } from "../../../lib/logger";
import { safeErrorMessage } from "../../../lib/validate";
import { syncEmpresa, syncTodas } from "../../../lib/syncOt";

const CRON_SECRET = process.env.CRON_SECRET;
const ROLES_OK = new Set(["gerencial", "administrativo"]);
const INTERVALO_EMPLEADO_MS = 5 * 60 * 1000;

/* ─── Handler ─── */
export async function POST(req) {
  try {
    const cronSecret = req.headers.get("x-cron-secret");

    if (cronSecret) {
      // Ruta de cron: sincroniza todas las empresas configuradas
      if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }
      const results = await syncTodas();
      return NextResponse.json({ ok: true, results });
    }

    // Ruta de usuario: sincroniza solo la empresa del token
    const sesion = await validarToken(req);
    if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const gestion = ROLES_OK.has(sesion.rol);
    const result = await syncEmpresa(sesion.empresa_id, { minIntervaloMs: gestion ? 0 : INTERVALO_EMPLEADO_MS });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("[sync-csv] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
