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
    ia_consultas_mes: 2000,   // consultas a la IA por mes y por empresa (auditoría F2-05)
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
  },
  free: {
    id: "free",
    nombre: "Free",
    precio: 0,
    moneda: "ARS",
    max_empleados: 5,
    max_ubicaciones: 0,
    max_proyectos: 2,
    ia_consultas_mes: 100,
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
  },
  starter: {
    id: "starter",
    nombre: "Starter",
    precio: 15000,
    moneda: "ARS",
    max_empleados: 15,
    max_ubicaciones: 1,
    max_proyectos: 10,
    ia_consultas_mes: 1000,
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
  },
  pro: {
    id: "pro",
    nombre: "Pro",
    precio: 35000,
    moneda: "ARS",
    max_empleados: 50,
    max_ubicaciones: 999,
    max_proyectos: 9999,
    ia_consultas_mes: 3000,
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
  },
  enterprise: {
    id: "enterprise",
    nombre: "Enterprise",
    precio: null, // a convenir
    moneda: "ARS",
    max_empleados: 99999,
    max_ubicaciones: 9999,
    max_proyectos: 99999,
    ia_consultas_mes: 10000,
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
  },
};

export const DESCUENTO_ANUAL = 0.20;

// ═══════════════════════════════════════════════════════════
// Precios en USD por tramos de operarios + add-ons (D16, D18, ítem 25)
//
// Dos líneas (Asistencia y Planta) con tres tramos de operarios activos.
// Cada combinación es un plan propio ("asistencia_15", "planta_40", …) para
// que el resto del sistema siga leyendo un solo valor en empresa.plan_activo.
// Los add-ons se guardan aparte (empresa.addons) y suman módulos o cupo.
// Los precios están en dólares y se cobran en pesos al tipo de cambio de
// referencia del día (app/lib/cotizacion.js). Son hipótesis a validar con
// clientes (fase 6): se cambian acá y en ningún otro lado.
// Starter/Pro quedan para las suscripciones que ya existían.
// ═══════════════════════════════════════════════════════════

export const TRAMOS = [15, 40, 80];

export const LINEAS = {
  asistencia: {
    id: "asistencia",
    nombre: "Asistencia",
    descripcion: "Fichaje con botón, QR, PIN, kiosco y GPS; solicitudes, horarios, liquidación de horas y resumen semanal.",
    usd: { 15: 20, 40: 45, 80: 80 },
  },
  planta: {
    id: "planta",
    nombre: "Planta",
    descripcion: "Todo Asistencia, más órdenes de trabajo y etapas, tareas con tiempo improductivo y su causa, tablero en vivo y reportes por OT.",
    usd: { 15: 45, 40: 95, 80: 160 },
  },
};

export const ADDONS = {
  ia: {
    id: "ia",
    nombre: "Asistente IA",
    usd: 15,
    descripcion: "Hasta 2.000 consultas por mes al asistente (sin el add-on son 200).",
    ia_consultas_extra: 1800,
    modulos: [],
  },
  campo: {
    id: "campo",
    nombre: "Trabajo en campo",
    usd: 20,
    descripcion: "Reportes de obra desde el celular, con fotos y ayuda de la IA.",
    ia_consultas_extra: 0,
    modulos: ["obra"],
  },
};

const BASE_LINEA = {
  asistencia: {
    max_ubicaciones: 999,
    max_proyectos: 0,
    ia_consultas_mes: 200,
    modulos: ["fichaje", "chat", "reportes", "calendario"],
    exportar_csv: true,
    exportar_pdf: true,
    calendario: true,
    geolocalizacion: true,
    reglas_bot: true,
    reportes_avanzados: false,
    soporte: "email",
  },
  planta: {
    max_ubicaciones: 999,
    max_proyectos: 99999,
    ia_consultas_mes: 200,
    modulos: ["fichaje", "chat", "actividad", "proyectos", "reportes", "calendario"],
    exportar_csv: true,
    exportar_pdf: true,
    calendario: true,
    geolocalizacion: true,
    reglas_bot: true,
    reportes_avanzados: true,
    soporte: "prioritario",
  },
};

for (const linea of Object.values(LINEAS)) {
  for (const tramo of TRAMOS) {
    const id = `${linea.id}_${tramo}`;
    PLANES[id] = {
      id,
      nombre: `${linea.nombre} · hasta ${tramo}`,
      linea: linea.id,
      tramo,
      precio: null, // en pesos: depende de la cotización del día
      precio_usd: linea.usd[tramo],
      moneda: "USD",
      max_empleados: tramo,
      ...BASE_LINEA[linea.id],
      branding_gypi: false,
      api_access: false,
    };
  }
}

export function esPlanPorTramos(planId) {
  return !!PLANES[planId]?.linea;
}

/** Plan de la línea que alcanza para esa cantidad de operarios (null: más de 80, a medida). */
export function planParaOperarios(linea, operarios) {
  if (!LINEAS[linea]) return null;
  const tramo = TRAMOS.find((t) => t >= Math.max(0, Number(operarios) || 0));
  return tramo ? `${linea}_${tramo}` : null;
}

/** Add-ons conocidos, sin repetir. */
export function addonsValidos(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).filter((a) => ADDONS[a]))];
}

/** Precio mensual en USD del plan con sus add-ons (con el descuento si es anual). */
export function precioUsd({ plan, addons = [], periodo = "mensual" }) {
  const base = PLANES[plan]?.precio_usd;
  if (base == null) return null;
  const total = base + addonsValidos(addons).reduce((s, a) => s + ADDONS[a].usd, 0);
  const conDescuento = periodo === "anual" ? total * (1 - DESCUENTO_ANUAL) : total;
  return Math.round(conDescuento * 100) / 100;
}

/** USD → pesos al tipo de cambio dado, redondeado hacia arriba a $100. */
export function aPesos(usd, cotizacion) {
  if (!(usd > 0) || !(cotizacion > 0)) return null;
  return Math.ceil((usd * cotizacion) / 100) * 100;
}

/** Lo que Mercado Pago cobra por período: el mensual, o 12 meses juntos si es anual. */
export function montoCobro(precioMensual, periodo = "mensual") {
  const m = Number(precioMensual) || 0;
  return periodo === "anual" ? m * 12 : m;
}

/**
 * Plan a sugerir cuando se llega a un límite: el tramo siguiente de la misma
 * línea (o Enterprise), y Planta si lo que falta son las OT.
 */
export function planSiguiente(plan, { necesitaPlanta = false } = {}) {
  const p = PLANES[plan];
  if (p?.linea) {
    if (necesitaPlanta && p.linea === "asistencia") return `planta_${p.tramo}`;
    const sig = TRAMOS.find((t) => t > p.tramo);
    return sig ? `${p.linea}_${sig}` : "enterprise";
  }
  if (plan === "pro" || plan === "enterprise") return "enterprise";
  if (plan === "starter") return "planta_40";
  return necesitaPlanta ? "planta_15" : "asistencia_15";
}

/** Plan + add-ons: módulos y cupo de IA que la empresa tiene en la práctica. */
export function capacidades(plan, addons = []) {
  const p = PLANES[plan] || PLANES.free;
  const extras = addonsValidos(addons).map((a) => ADDONS[a]);
  return {
    ...p,
    modulos: [...new Set([...(p.modulos || []), ...extras.flatMap((a) => a.modulos)])],
    ia_consultas_mes: (p.ia_consultas_mes || 0) + extras.reduce((s, a) => s + a.ia_consultas_extra, 0),
    addons: extras.map((a) => a.id),
  };
}

// Solo versión paga con prueba de 30 días (D20). "free" ya no es un plan que
// se ofrezca: quedó como el estado interno de una cuenta sin plan vigente
// (prueba vencida o suscripción cancelada), que no puede cargar datos nuevos.
export const DIAS_TRIAL = 30;

export function planVigente(plan) {
  return !!plan && plan !== "free";
}

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