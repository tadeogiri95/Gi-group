// app/lib/finanzasApi.js — Lo que comparten las rutas de Finanzas
// (/api/finanzas y /api/finanzas/operaciones): solo el rol Dueño entra, con el
// módulo prendido, y el aviso claro si falta la migración 171.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "./auth";
import { safeErrorMessage } from "./validate";
import { requireModulo } from "./planEnforcement";
import { logger } from "./logger";
import { esDuenoFinanzas } from "./finanzas";

export const FALTA_MIGRACION_FIN = "Para Finanzas falta correr la migración 171 en Supabase.";

const faltaMigracion = (err) => /fin_(cuentas|tipos_operacion|tesoreria|centros_costo|operaciones)/.test(String(err?.message))
  && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));

/** { sesion } si es el Dueño con Finanzas prendido; si no, { response } con el error. */
export async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!esDuenoFinanzas(sesion)) return { response: NextResponse.json({ error: "Finanzas es solo para el dueño" }, { status: 403 }) };
  const sinModulo = await requireModulo(sesion.empresa_id, "finanzas");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

/** Respuesta de error: 409 si falta la migración, 500 si no. */
export function errorFinanzas(err, donde) {
  if (faltaMigracion(err)) return NextResponse.json({ error: FALTA_MIGRACION_FIN, falta_migracion: true }, { status: 409 });
  logger.error(`[finanzas] ${donde}`, err);
  return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
}
