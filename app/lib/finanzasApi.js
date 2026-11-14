// app/lib/finanzasApi.js — Lo que comparten las rutas de Finanzas
// (/api/finanzas y /api/finanzas/operaciones): solo el rol Dueño entra, con el
// módulo prendido, y el aviso claro si falta la migración 171.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "./auth";
import { safeErrorMessage } from "./validate";
import { requireModuloSesion } from "./accesosServidor";
import { logger } from "./logger";
import { esDuenoFinanzas } from "./finanzas";
import { mesCerradoDeError, textoMesCerrado } from "./finanzasMeses";

export const FALTA_MIGRACION_FIN = "Para Finanzas falta correr la migración 171 en Supabase.";

const faltaMigracion = (err) => /fin_(cuentas|tipos_operacion|tesoreria|centros_costo|operaciones)/.test(String(err?.message))
  && /does not exist|42P01|PGRST20[05]|schema cache/.test(String(err?.message));

/**
 * La cuenta que la base rechazó por no estar en el plan (migración 193:
 * fin_operaciones_cuenta_debe_plan / _haber_plan), o null.
 */
export function cuentaFueraDelPlan(err) {
  const m = String(err?.message ?? err ?? "");
  if (!/fin_operaciones_cuenta_(debe|haber)_plan/.test(m)) return null;
  return /cuenta_(?:debe|haber)\)=\([^,]+,\s*([^)]+)\)/.exec(m)?.[1]?.trim() || "";
}

/** Lo que ve el usuario cuando la cuenta no está en el plan. */
export const textoCuentaFueraDelPlan = (cuenta) =>
  `La cuenta ${cuenta ? `${cuenta} ` : ""}no está en el plan de cuentas. Sumala en Finanzas → Configuración → Plan de cuentas o elegí otra.`;

/** { sesion } si es el Dueño con Finanzas prendido; si no, { response } con el error. */
export async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!esDuenoFinanzas(sesion)) return { response: NextResponse.json({ error: "Finanzas es solo para el dueño" }, { status: 403 }) };
  const sinModulo = await requireModuloSesion(sesion, "finanzas");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

/** Respuesta de error: 409 si falta la migración o el mes está cerrado, 500 si no. */
export function errorFinanzas(err, donde) {
  const mesCerrado = mesCerradoDeError(err);
  if (mesCerrado) return NextResponse.json({ error: textoMesCerrado(mesCerrado), mes_cerrado: mesCerrado }, { status: 409 });
  if (faltaMigracion(err)) return NextResponse.json({ error: FALTA_MIGRACION_FIN, falta_migracion: true }, { status: 409 });
  const fuera = cuentaFueraDelPlan(err);
  if (fuera !== null) return NextResponse.json({ error: textoCuentaFueraDelPlan(fuera), cuenta_fuera_del_plan: fuera }, { status: 400 });
  logger.error(`[finanzas] ${donde}`, err);
  return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
}
