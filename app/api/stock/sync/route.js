// POST /api/stock/sync — Copia los artículos y el stock de la planilla MRP de
// la empresa (Stock, parte 13; ítem 40; migración 106). Botón "Sincronizar"
// de la pantalla Stock; todas las mañanas lo hace /api/cron/sync-ot.
// Solo gestión. Con RLS_RUTAS=on va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { broadcastRefresh } from "../../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../../lib/planEnforcement";
import { syncStockEmpresa, faltaMigracionStock } from "../../../lib/syncStock";
import { logger } from "../../../lib/logger";

export const maxDuration = 60;

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado puede sincronizar el stock" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    // Stock va con las OT hasta que sea un módulo que se venda aparte
    const sinModulo = await requireModulo(sesion.empresa_id, "proyectos");
    if (sinModulo) return sinModulo;
    try {
      const resultado = await syncStockEmpresa(sesion.empresa_id, { sesion });
      broadcastRefresh(sesion.empresa_id, "articulos_stock");
      return NextResponse.json({ ok: true, ...resultado });
    } catch (err) {
      if (faltaMigracionStock(err)) {
        return NextResponse.json({ error: "Para el stock falta correr la migración 106 en Supabase." }, { status: 409 });
      }
      if (err?.aviso) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  } catch (err) {
    logger.error("[stock/sync] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
