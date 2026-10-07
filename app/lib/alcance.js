// app/lib/alcance.js — Alcance de un supervisor de división (decisión D2, ítem 22).
//
// Roles: operario (operativo), supervisor y administrador (administrativo) y
// dueño (gerencial). Un administrativo marcado con solo_su_division
// (migración 075) es supervisor: solo ve y gestiona a los empleados de su
// división. El resto de gestión no tiene alcance (ve toda la empresa).
//
// Las rutas que todavía no saben filtrar por división le responden 403 a un
// supervisor (rechazarSiSupervisor), así nunca ve de más.
import { NextResponse } from "next/server";
import { sbGet } from "./sbHelpers";

const CACHE_MS = 60 * 1000;
const cache = new Map(); // empleado_id → { ts, alcance }

/** Para los tests. */
export function _limpiarCacheAlcance() {
  cache.clear();
}

// Si la migración 075 todavía no se corrió, la columna no existe y nadie puede
// estar marcado como supervisor → sin alcance. Cualquier otro error corta la
// operación (mejor un error que mostrarle a un supervisor toda la empresa).
async function leerSupervisor(sesion) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=id,legajo,division,solo_su_division&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  if (r.ok) return r.json();
  const texto = await r.text().catch(() => "");
  if (r.status === 400 && texto.includes("solo_su_division")) return [];
  throw new Error(`No se pudo verificar el alcance del usuario (HTTP ${r.status})`);
}

/**
 * Alcance de la sesión, o null si ve toda la empresa.
 * @returns {Promise<null | { division: string|null, ids: string[], legajos: string[] }>}
 */
export async function alcanceDe(sesion) {
  if (sesion?.rol !== "administrativo" || !sesion.empleado_id) return null;
  const guardado = cache.get(sesion.empleado_id);
  if (guardado && Date.now() - guardado.ts < CACHE_MS) return guardado.alcance;

  const yo = await leerSupervisor(sesion);
  let alcance = null;
  const fila = yo?.[0];
  if (fila?.solo_su_division) {
    // Sin división asignada, el supervisor solo se ve a sí mismo
    const miembros = fila.division
      ? await sbGet(`empleados?empresa_id=eq.${sesion.empresa_id}&division=eq.${encodeURIComponent(fila.division)}&select=id,legajo`)
      : [];
    const todos = [...(miembros || []), { id: fila.id, legajo: fila.legajo }];
    alcance = {
      division: fila.division || null,
      ids: [...new Set(todos.map((m) => String(m.id)))],
      legajos: [...new Set(todos.map((m) => String(m.legajo)))],
    };
  }
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  cache.set(sesion.empleado_id, { ts: Date.now(), alcance });
  return alcance;
}

// Tablas con datos por persona: columna que identifica a la persona y de qué
// lista del alcance sale el filtro.
export const COLUMNA_PERSONA = {
  empleados: { col: "id", lista: "ids" },
  fichadas: { col: "legajo", lista: "legajos" },
  solicitudes: { col: "legajo", lista: "legajos" },
  registro_actividades: { col: "empleado_id", lista: "ids" },
  reportes_obra: { col: "legajo", lista: "legajos" },
  mensajes_chat: { col: "empleado_id", lista: "ids" },
  turnos_planificados: { col: "empleado_id", lista: "ids" },
  documentos_exigidos_empleado: { col: "empleado_id", lista: "ids" },
  documentos_empleado: { col: "empleado_id", lista: "ids" },
  geo_registros: { col: "empleado_id", lista: "ids" },
  v_resumen_diario: { col: "empleado_id", lista: "ids" },
  v_scores_empleados: { col: "empleado_id", lista: "ids" },
};

/** Filtro de PostgREST para un supervisor sobre `tabla`, o null si la tabla no es por persona. */
export function filtroAlcance(tabla, alcance) {
  const regla = alcance && COLUMNA_PERSONA[tabla];
  if (!regla) return null;
  const valores = alcance[regla.lista];
  return `${regla.col}=in.(${valores.map(encodeURIComponent).join(",")})`;
}

/** ¿El empleado (por id o legajo) está dentro del alcance? Sin alcance, siempre sí. */
export function dentroDelAlcance(alcance, { id, legajo } = {}) {
  if (!alcance) return true;
  if (id !== undefined && id !== null) return alcance.ids.includes(String(id));
  if (legajo !== undefined && legajo !== null) return alcance.legajos.includes(String(legajo));
  return false;
}

export function respuestaFueraDeAlcance() {
  return NextResponse.json({ error: "Ese empleado no es de tu división" }, { status: 403 });
}

/** Para rutas que todavía no filtran por división: un supervisor no puede usarlas. */
export async function rechazarSiSupervisor(sesion) {
  const alcance = await alcanceDe(sesion);
  if (!alcance) return null;
  return NextResponse.json({ error: "Como supervisor de división no tenés acceso a esta función. Pedísela a un administrador." }, { status: 403 });
}
