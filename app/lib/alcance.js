// app/lib/alcance.js — ¿La sesión es de un Supervisor?
//
// Roles: operario (operativo), administración (administrativo) y dueño
// (gerencial). Un administrativo marcado con solo_su_division (migración 075)
// se llama "Supervisor".
//
// Hasta el 05/11/2026 el supervisor solo veía a la gente de su división y no
// tenía varias funciones de oficina. Desde entonces (pedido de Tadeo) ve toda
// la empresa y puede hacer lo mismo que el Dueño, incluida la planificación.
// Siguen siendo solo del Dueño: el pago del plan (facturación, baja de la
// cuenta) y nombrar Dueños o Supervisores (cambiar el rol o la casilla).
// La casilla todavía sirve para los avisos de fin de proceso de su división
// (finProcesoServidor.js).
//
// La sesión no trae la casilla: se lee de la base (con el pase del usuario si
// RLS_RUTAS=on) y se guarda un minuto.
import { sbHeaders } from "./sbHelpers";

const CACHE_MS = 60 * 1000;
const cache = new Map(); // empleado_id → { ts, supervisor }

/** Para los tests. */
export function _limpiarCacheAlcance() {
  cache.clear();
}

// Sin la migración 075 la columna no existe: nadie es supervisor.
async function leerCasilla(sesion) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const r = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=id,solo_su_division&limit=1`,
    { headers: await sbHeaders({ sesion }) }
  );
  if (r.ok) return !!(await r.json())?.[0]?.solo_su_division;
  const texto = await r.text().catch(() => "");
  if (r.status === 400 && texto.includes("solo_su_division")) return false;
  throw new Error(`No se pudo verificar el rol del usuario (HTTP ${r.status})`);
}

/** ¿Es un Supervisor (administrativo con la casilla "solo su división")? */
export async function esSupervisorSesion(sesion) {
  if (sesion?.rol !== "administrativo" || !sesion.empleado_id) return false;
  const guardado = cache.get(sesion.empleado_id);
  if (guardado && Date.now() - guardado.ts < CACHE_MS) return guardado.supervisor;
  const supervisor = await leerCasilla(sesion);
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  cache.set(sesion.empleado_id, { ts: Date.now(), supervisor });
  return supervisor;
}

/** ¿Puede hacer lo que hace el Dueño? Dueño (gerencial) o Supervisor. */
export async function comoDueno(sesion) {
  if (sesion?.rol === "gerencial") return true;
  return esSupervisorSesion(sesion);
}
