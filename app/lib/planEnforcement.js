// ═══════════════════════════════════════════════════════════
// Validación backend de límites por plan
// Se llama desde /api/data antes de POST en tablas sensibles
// ═══════════════════════════════════════════════════════════

import { PLANES, planTieneModulo, planLimite, planPermite } from "./plans";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cache simple en memoria (5 min) para no consultar plan en cada request
const cache = new Map();
const TTL = 5 * 60 * 1000;

export async function getPlanEmpresa(empresaId) {
  if (!empresaId) return "free";
  const cached = cache.get(empresaId);
  if (cached && Date.now() - cached.t < TTL) return cached.plan;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa?id=eq.${empresaId}&select=plan_activo,plan_vence`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
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
    return "free";
  }
}

export function invalidarCachePlan(empresaId) {
  if (empresaId) cache.delete(empresaId);
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
export async function validarLimite({ tabla, empresaId, body, method }) {
  if (method !== "POST" || !empresaId) return { ok: true };

  const plan = await getPlanEmpresa(empresaId);
  const planInfo = PLANES[plan] || PLANES.free;

  // ─── empleados: chequear max_empleados ───
  if (tabla === "empleados") {
    // Solo cuenta activos
    const actuales = await contarFilas("empleados", empresaId, "&activo=eq.true");
    if (actuales >= planInfo.max_empleados) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} permite hasta ${planInfo.max_empleados} empleados activos. Tenés ${actuales}. Actualizá el plan para agregar más.`,
        upgrade_a: plan === "free" ? "starter" : plan === "starter" ? "pro" : "enterprise",
      };
    }
  }

  // ─── geo_zonas: chequear max_ubicaciones ───
  if (tabla === "geo_zonas") {
    if (planInfo.max_ubicaciones === 0) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} no incluye control de ubicación. Actualizá a Starter o superior.`,
        upgrade_a: "starter",
      };
    }
    const actuales = await contarFilas("geo_zonas", empresaId);
    if (actuales >= planInfo.max_ubicaciones) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} permite hasta ${planInfo.max_ubicaciones} ubicación(es). Actualizá a Pro para tener ilimitadas.`,
        upgrade_a: "pro",
      };
    }
  }

  // ─── reglas_bot: solo Pro+ ───
  if (tabla === "reglas_bot") {
    if (!planPermite(plan, "reglas_bot")) {
      return {
        ok: false,
        error: `Las reglas personalizadas del bot requieren plan Pro o Enterprise.`,
        upgrade_a: "pro",
      };
    }
  }

  // ─── notas_calendario: solo Pro+ ───
  if (tabla === "notas_calendario") {
    if (!planPermite(plan, "calendario")) {
      return {
        ok: false,
        error: `El calendario con notas requiere plan Pro o Enterprise.`,
        upgrade_a: "pro",
      };
    }
  }

  // ─── turnos_planificados: mismo gate que notas_calendario (feature "calendario") ───
  if (tabla === "turnos_planificados") {
    if (!planPermite(plan, "calendario")) {
      return {
        ok: false,
        error: `La planificación de turnos requiere plan Pro o Enterprise.`,
        upgrade_a: "pro",
      };
    }
  }

  // ─── reportes_obra: requiere módulo "reportes" (no incluido en Free) ───
  if (tabla === "reportes_obra") {
    if (!planTieneModulo(plan, "reportes")) {
      return {
        ok: false,
        error: `Los reportes de obra requieren plan Starter o superior.`,
        upgrade_a: "starter",
      };
    }
  }

  // ─── proyectos: chequear max_proyectos ───
  if (tabla === "proyectos") {
    const max = planLimite(plan, "max_proyectos");
    const actuales = await contarFilas("proyectos", empresaId);
    if (actuales >= max) {
      return {
        ok: false,
        error: `Tu plan ${planInfo.nombre} permite hasta ${max} proyectos. Actualizá tu plan para crear más.`,
        upgrade_a: plan === "free" ? "starter" : "pro",
      };
    }
  }

  return { ok: true };
}