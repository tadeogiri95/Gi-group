// /api/valor-ot — El valor de cada OT para las pantallas de Producción
// (Tadeo, 23/11: igual en toda la app; reglas en app/lib/valorOtServidor.js).
//
//   GET → { valores: [[ot, valor, estimado (1/0)], …] }: el PRECIO del Plan
//         (sin IVA) y, para las OT sin precio, la estimación por materiales.
// Solo los que ven precios: gerencial y administrativo (Dueño, Supervisor y
// Administración), con el módulo de OT. Con RLS_RUTAS=on las consultas van
// con el pase del usuario.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { requireModuloSesion } from "../../lib/accesosServidor";
import { valoresDeOts } from "../../lib/valorOtServidor";
import { safeErrorMessage } from "../../lib/validate";
import { logger } from "../../lib/logger";

const ROLES_PERMITIDOS = new Set(["gerencial", "administrativo"]);

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_PERMITIDOS.has(sesion.rol)) return NextResponse.json({ error: "Solo gerencia y administración ven el valor de las OT" }, { status: 403 });
    const sinModulo = await requireModuloSesion(sesion, "proyectos");
    if (sinModulo) return sinModulo;
    const valores = await valoresDeOts(sesion, sesion.empresa_id);
    return NextResponse.json({ valores: [...valores].map(([ot, v]) => [ot, v.valor, v.estimado ? 1 : 0]) });
  } catch (err) {
    logger.error("[valor-ot] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
