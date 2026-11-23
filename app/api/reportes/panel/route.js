// app/api/reportes/panel — Panel de control de la producción (Tadeo, 23/11;
// app/lib/panelProduccion.js).
//
//   GET ?fecha=AAAA-MM-DD → los indicadores de la semana de esa fecha (de
//                           lunes a domingo) y de las 4 anteriores
// Solo gerencial y administrativo (Dueño, Supervisor y Administración), con el
// módulo de OT. Con RLS_RUTAS=on las consultas van con el pase del usuario.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { panelDeEmpresa } from "../../../lib/panelProduccionServidor";
import { safeErrorMessage } from "../../../lib/validate";
import { hoyArg } from "../../../lib/dates";
import { logger } from "../../../lib/logger";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const json = (body, status = 200) => NextResponse.json(body, { status });

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_PERMITIDOS.has(sesion.rol)) return json({ error: "Solo gerencia y administración ven el panel de producción" }, 403);
    const sinModulo = await requireModuloSesion(sesion, "proyectos");
    if (sinModulo) return sinModulo;
    const fecha = new URL(request.url).searchParams.get("fecha") || hoyArg();
    if (!FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha))) return json({ error: "Fecha inválida (AAAA-MM-DD)" }, 400);
    if (fecha > hoyArg()) return json({ error: "Esa semana todavía no empezó" }, 400);
    const panel = await panelDeEmpresa(sesion.empresa_id, fecha, { sesion, conPrecios: true });
    return json({ ok: true, panel });
  } catch (err) {
    logger.error("[reportes/panel] error", err);
    return json({ error: safeErrorMessage(err) }, 500);
  }
}
