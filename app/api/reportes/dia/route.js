// app/api/reportes/dia — Reporte del día de producción e instalación
// (seguimiento de OT por escaneo, parte 26).
//
// GET ?fecha=YYYY-MM-DD (sin fecha: hoy). Solo gerencial y administrativo.
// Con RLS_RUTAS=on las consultas van con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { requireModulo } from "../../../lib/planEnforcement";
import { reporteDiarioDeEmpresa } from "../../../lib/reporteDiarioServidor";
import { safeErrorMessage } from "../../../lib/validate";
import { hoyArg } from "../../../lib/dates";
import { logger } from "../../../lib/logger";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_PERMITIDOS.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo gerencial o administrativo puede ver el reporte del día" }, { status: 403 });
    }
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;

    const fecha = new URL(request.url).searchParams.get("fecha") || hoyArg();
    if (!FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha))) {
      return NextResponse.json({ error: "Fecha inválida (YYYY-MM-DD)" }, { status: 400 });
    }
    if (fecha > hoyArg()) return NextResponse.json({ error: "Ese día todavía no pasó" }, { status: 400 });

    const reporte = await reporteDiarioDeEmpresa(sesion.empresa_id, fecha, { sesion });
    return NextResponse.json({ ok: true, reporte });
  } catch (err) {
    logger.error("[reportes/dia] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
