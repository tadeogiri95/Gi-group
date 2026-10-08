// ═══════════════════════════════════════════════════════════
// Validación backend de límites por plan
// Se llama desde /api/data antes de POST en tablas sensibles
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { PLANES, planLimite, planPermite, planVigente, capacidades, planSiguiente } from "./plans";
import { modulosEfectivos, configModulos, comoSumarModulo } from "./modulos";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cache simple en memoria (5 min) para no consultar plan en cada request
const cache = new Map();
const TTL = 5 * 60 * 1000;

// `siFalla`: qué devolver si no se puede leer el plan (por defecto "free", lo
// más restrictivo para los límites; rechazarSiSinPlan pide null para no
// bloquear a nadie por un corte momentáneo de la base).
export async function getPlanEmpresa(empresaId, { siFalla = "free" } = {}) {
  if (!empresaId) return siFalla;
  const cached = cache.get(empresaId);
  if (cached && Date.now() - cached.t < TTL) return cached.plan;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa?id=eq.${empresaId}&select=plan_activo,plan_vence`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return siFalla;
    const data = await res.json();
    let plan = data?.[0]?.plan_activo || "free";

    // P2: Si plan_vence expiró, el grace period terminó → degradar a free
    const planVence = data?.[0]?.plan_vence;
    if (planVence && new Date(planVence) < new Date()) {
      plan = "free";
      // Limpiar en background (fire-and-forget)
      fetch(`${SUPABASE_URL}/rest/v1/empresa?id=eq.${empresaId}`, {
        method: "PATCH",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan_activo: "free", plan_vence: null }),
      }).catch(() => {});
    }

    cache.set(empresaId, { plan, t: Date.now() });
    return plan;
  } catch {
    return siFalla;
  }
}

// Add-ons contratados (empresa.addons, migración 082). Consulta aparte y
// silenciosa: sin la migración la columna no existe y no hay add-ons, pero el
// plan se sigue leyendo bien.
const cacheAddons = new Map();
export async function getAddonsEmpresa(empresaId) {
  if (!empresaId) return [];
  const cached = cacheAddons.get(empresaId);
  if (cached && Date.now() - cached.t < TTL) return cached.addons;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa?id=eq.${empresaId}&select=addons`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const addons = Array.isArray(data?.[0]?.addons) ? data[0].addons : [];
    cacheAddons.set(empresaId, { addons, t: Date.now() });
    return addons;
  } catch {
    return [];
  }
}

// Ajustes de módulos propios de la empresa (tabla empresa_modulos, migración
// 083). Silencioso: sin la tabla no hay ajustes y vale lo del plan.
const cacheAjustes = new Map();
async function getAjustesModulos(empresaId) {
  if (!empresaId) return [];
  const cached = cacheAjustes.get(empresaId);
  if (cached && Date.now() - cached.t < TTL) return cached.ajustes;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa_modulos?empresa_id=eq.${empresaId}&select=modulo,activo,config`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const ajustes = Array.isArray(data) ? data : [];
    cacheAjustes.set(empresaId, { ajustes, t: Date.now() });
    return ajustes;
  } catch {
    return [];
  }
}

/**
 * Plan, add-ons y módulos que la empresa tiene en la práctica (ítem 36).
 * `capacidades` trae los límites del plan con el cupo de IA de los add-ons.
 * Si la ruta ya leyó el plan de la empresa, lo pasa en `plan` y no se vuelve a pedir.
 */
export async function getModulosEmpresa(empresaId, { plan: planLeido } = {}) {
  const [plan, addons, ajustes] = await Promise.all([
    planLeido ?? getPlanEmpresa(empresaId),
    getAddonsEmpresa(empresaId),
    getAjustesModulos(empresaId),
  ]);
  return {
    plan,
    addons,
    modulos: modulosEfectivos({ plan, addons, ajustes }),
    config: configModulos(ajustes),
    capacidades: capacidades(plan, addons),
  };
}

/**
 * Corta con 402 si la empresa no tiene el módulo (ítem 36).
 * @returns {Promise<NextResponse|null>}
 */
export async function requireModulo(empresaId, modulo) {
  const { plan, modulos } = await getModulosEmpresa(empresaId);
  if (modulos.includes(modulo)) return null;
  const { error, upgrade_a } = comoSumarModulo(plan, modulo);
  return NextResponse.json({ ok: false, error, tipo: "sin_modulo", modulo, upgrade_a, paywall: true }, { status: 402 });
}

export const MENSAJE_SIN_PLAN = "La cuenta de tu empresa está en pausa: terminó la prueba o la suscripción no está activa. El dueño puede elegir un plan para seguir cargando datos.";

/**
 * Sin plan vigente (D20: prueba vencida o suscripción cancelada) no se cargan
 * datos nuevos. Se pueden seguir viendo y descargando, y pagar.
 * @returns {Promise<NextResponse|null>} 402 para cortar, o null para seguir
 */
export async function rechazarSiSinPlan(empresaId) {
  const plan = await getPlanEmpresa(empresaId, { siFalla: null });
  if (plan === null || planVigente(plan)) return null;
  return NextResponse.json({ ok: false, error: MENSAJE_SIN_PLAN, tipo: "sin_plan", paywall: true }, { status: 402 });
}

export function invalidarCachePlan(empresaId) {
  if (empresaId) { cache.delete(empresaId); cacheAddons.delete(empresaId); cacheAjustes.delete(empresaId); }
}

// Cuenta filas activas en una tabla para una empresa
async function contarFilas(tabla, empresaId, filtroExtra = "") {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${tabla}?empresa_id=eq.${empresaId}${filtroExtra}&select=id`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "count=exact" } }
    );
    const range = res.headers.get("content-range") || "0/0";
    return parseInt(range.split("/")[1] || "0", 10);
  } catch { return 0; }
}

/**
 * Valida si se puede crear un registro nuevo según el plan.
 * Retorna { ok: true } o { ok: false, error, upgrade_a }
 */
// Tablas que pertenecen a un módulo: sin el módulo no se cargan (ítem 36)
const TABLA_MODULO = {
  notas_calendario: "calendario",
  turnos_planificados: "calendario",
  reportes_obra: "obra",
  proyectos: "proyectos",
  registro_actividades: "actividad",
};

export async function validarLimite({ tabla, empresaId, body, method }) {
  if (method !== "POST" || !empresaId) return { ok: true };

  const plan = await getPlanEmpresa(empresaId);
  const planInfo = PLANES[plan] || PLANES.free;

  // ─── Módulo de la tabla (plan + add-ons + ajustes de la empresa) ───
  const modulo = TABLA_MODULO[tabla];
  let modulosEmpresa = null;
  if (modulo) {
    ({ modulos: modulosEmpresa } = await getModulosEmpresa(empresaId));
    if (!modulosEmpresa.includes(modulo)) return { ok: false, ...comoSumarModulo(plan, modulo) };
  }

  // ─── empleados: chequear max_empleados ───
  if (tabla === "empleados") {
    // Solo cuenta activos
    const actuales = await contarFilas("empleados", empresaId, "&activo=eq.true");
    if (actuales >= planInfo.max_empleados) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} permite hasta ${planInfo.max_empleados} empleados activos. Tenés ${actuales}. Pasá al tramo siguiente para agregar más.`,
        upgrade_a: planSiguiente(plan),
      };
    }
  }

  // ─── geo_zonas: chequear max_ubicaciones ───
  if (tabla === "geo_zonas") {
    if (planInfo.max_ubicaciones === 0) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} no incluye control de ubicación. Está incluido en Asistencia y en Planta.`,
        upgrade_a: planSiguiente(plan),
      };
    }
    const actuales = await contarFilas("geo_zonas", empresaId);
    if (actuales >= planInfo.max_ubicaciones) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} permite hasta ${planInfo.max_ubicaciones} ubicación(es). Asistencia y Planta las tienen ilimitadas.`,
        upgrade_a: planSiguiente(plan),
      };
    }
  }

  // ─── reglas_bot: solo Pro+ ───
  if (tabla === "reglas_bot") {
    if (!planPermite(plan, "reglas_bot")) {
      return {
        ok: false,
        error: `Las reglas personalizadas del bot requieren un plan Asistencia, Planta o Enterprise.`,
        upgrade_a: planSiguiente(plan),
      };
    }
  }

  // ─── proyectos: chequear max_proyectos ───
  if (tabla === "proyectos") {
    // Un plan sin OT al que se le dio el módulo a mano no tiene tope
    const max = planLimite(plan, "max_proyectos") || (modulosEmpresa?.includes("proyectos") ? Infinity : 0);
    const actuales = await contarFilas("proyectos", empresaId);
    if (actuales >= max) {
      return {
        ok: false,
        error: max === 0
          ? `Las órdenes de trabajo son parte del plan Planta. Tu plan ${planInfo.nombre} incluye solo asistencia.`
          : `Tu plan ${planInfo.nombre} permite hasta ${max} proyectos. Actualizá tu plan para crear más.`,
        upgrade_a: planSiguiente(plan, { necesitaPlanta: max === 0 }),
      };
    }
  }

  return { ok: true };
}