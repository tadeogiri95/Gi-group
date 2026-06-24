// ═══════════════════════════════════════════════════════════
// Configuración de planes y features
// Fuente única de verdad para límites y permisos
// ═══════════════════════════════════════════════════════════

export const PLANES = {
  trial: {
    id: "trial",
    nombre: "Trial Pro",
    precio: 0,
    moneda: "ARS",
    max_empleados: 50,
    max_ubicaciones: 999,
    max_proyectos: 9999,
    modulos: ["fichaje", "chat", "actividad", "proyectos", "reportes", "obra", "calendario"],
    exportar_csv: true,
    exportar_pdf: true,
    calendario: true,
    geolocalizacion: true,
    reglas_bot: true,
    reportes_avanzados: true,
    soporte: "email",
    branding_gypi: false,
    api_access: false,
    mostrar_publicidad: false,
  },
  free: {
    id: "free",
    nombre: "Free",
    precio: 0,
    moneda: "ARS",
    max_empleados: 5,
    max_ubicaciones: 0,
    max_proyectos: 2,
    modulos: ["fichaje", "chat", "actividad"],
    exportar_csv: false,
    exportar_pdf: false,
    calendario: false,
    geolocalizacion: false,
    reglas_bot: false,
    reportes_avanzados: false,
    soporte: false,
    branding_gypi: true,
    api_access: false,
    mostrar_publicidad: true,
  },
  starter: {
    id: "starter",
    nombre: "Starter",
    precio: 15000,
    moneda: "ARS",
    max_empleados: 15,
    max_ubicaciones: 1,
    max_proyectos: 10,
    modulos: ["fichaje", "chat", "actividad", "proyectos", "reportes", "obra"],
    exportar_csv: true,
    exportar_pdf: false,
    calendario: false,
    geolocalizacion: true,
    reglas_bot: false,
    reportes_avanzados: false,
    soporte: "email",
    branding_gypi: false,
    api_access: false,
    mostrar_publicidad: false,
  },
  pro: {
    id: "pro",
    nombre: "Pro",
    precio: 35000,
    moneda: "ARS",
    max_empleados: 50,
    max_ubicaciones: 999,
    max_proyectos: 9999,
    modulos: ["fichaje", "chat", "actividad", "proyectos", "reportes", "obra", "calendario"],
    exportar_csv: true,
    exportar_pdf: true,
    calendario: true,
    geolocalizacion: true,
    reglas_bot: true,
    reportes_avanzados: true,
    soporte: "prioritario",
    branding_gypi: false,
    api_access: false,
    mostrar_publicidad: false,
  },
  enterprise: {
    id: "enterprise",
    nombre: "Enterprise",
    precio: null, // a convenir
    moneda: "ARS",
    max_empleados: 99999,
    max_ubicaciones: 9999,
    max_proyectos: 99999,
    modulos: ["fichaje", "chat", "actividad", "proyectos", "reportes", "obra", "calendario"],
    exportar_csv: true,
    exportar_pdf: true,
    calendario: true,
    geolocalizacion: true,
    reglas_bot: true,
    reportes_avanzados: true,
    soporte: "sla",
    branding_gypi: false,
    api_access: true,
    mostrar_publicidad: false,
  },
};

export const DESCUENTO_ANUAL = 0.20;

export function precioAnual(planId) {
  const p = PLANES[planId] || PLANES.free;
  if (!p.precio) return null;
  return Math.round(p.precio * (1 - DESCUENTO_ANUAL));
}

// Helper backend/frontend: ¿el plan permite esta feature?
export function planPermite(plan, feature) {
  const p = PLANES[plan] || PLANES.free;
  return p[feature] === true || p[feature] === "email" || p[feature] === "prioritario" || p[feature] === "sla";
}

// Helper backend: ¿el plan permite este módulo?
export function planTieneModulo(plan, modulo) {
  const p = PLANES[plan] || PLANES.free;
  return (p.modulos || []).includes(modulo);
}

// Helper: límite numérico
export function planLimite(plan, campo) {
  const p = PLANES[plan] || PLANES.free;
  return p[campo] ?? 0;
}