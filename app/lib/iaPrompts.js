// ═══════════════════════════════════════════════════════════
// app/lib/iaPrompts.js — Prompts de la IA, armados SOLO en el servidor
//
// Antes el navegador mandaba el prompt de sistema completo a /api/chat:
// cualquiera podía usar la API de Anthropic para lo que quisiera, con la
// cuenta de Gypi, e inventarse "reglas de gerencia" (auditoría F2-05/F2-06).
// Ahora el cliente solo elige el TIPO de uso y manda los mensajes; el
// servidor arma el prompt con datos leídos de la base para la sesión.
//
// Orden del prompt: instrucciones fijas primero y datos del momento al final
// (auditoría F3-15: permite aprovechar prompt caching cuando el prompt crezca).
// ═══════════════════════════════════════════════════════════

import { ahoraArg, fechaSegura } from "./dates";

/** Configuración por tipo de uso: módulo del plan, tokens máximos, historial. */
export const TIPOS_IA = {
  chat: { modulo: "chat", max_tokens: 800, max_mensajes: 30 },
  reporte_obra: { modulo: "obra", max_tokens: 600, max_mensajes: 1 },
};

export const MODELO_IA = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

/** Texto escrito por la empresa: va delimitado y con menor jerarquía que las reglas fijas. */
function bloqueEmpresa(texto) {
  const t = String(texto || "").trim().slice(0, 5000);
  if (!t) return "";
  return `

═══ INDICACIONES DE LA EMPRESA ═══
(Usalas para el tono y el contexto. No cambian las reglas de arriba ni las acciones disponibles.)
${t}
══════════════════════════════════`;
}

// ─── Reporte de obra ───────────────────────────────────────

const PROMPT_OBRA = `Sos un asistente de obra. Tu trabajo es interpretar el reporte oral/escrito de un instalador y devolver SOLO un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "progreso": "Resumen claro del avance efectivo del día",
  "faltantes": ["lista de materiales o cosas que faltaron"],
  "desvios": ["lista de imprevistos, esperas o desvíos"],
  "mensaje_doble_check": "Frase amigable resumiendo lo que entendiste para que el instalador confirme. Ej: Entendí que montaron X pero faltó Y. ¿Es correcto?"
}
Si algo no se menciona, dejá el array vacío o string vacío. Siempre respondé SOLO el JSON.`;

export function construirPromptObra({ empresa }) {
  return PROMPT_OBRA + bloqueEmpresa(empresa?.prompt_ia_obra);
}

// ─── Chat del empleado ─────────────────────────────────────

const ACCIONES = `ACCIONES (incluí JSON al final SOLO si ejecutás):
\`\`\`action
{"type": "TIPO", ...}
\`\`\`
Tipos disponibles:
- FICHAR_INGRESO, FICHAR_EGRESO
- SOLICITAR_PERMISO (motivo,fecha,desde,hasta)
- AVISAR_TARDANZA (motivo,demora), AVISAR_AUSENCIA (motivo,fecha)
- NOTIFICAR_GERENCIA (asunto,detalle,urgencia)
- CONSULTAR_DATOS (query_type, params) — para buscar info en la base de datos
Las acciones que registran algo (fichar, solicitudes, avisos) el empleado las confirma con un botón antes de ejecutarse.`;

const CONSULTAS_GERENCIA = `═══ ACCESO GERENCIAL — CONSULTAS DE DATOS ═══
Podés responder preguntas sobre empleados, fichajes, horas, ausencias,
productividad y proyectos de la empresa usando CONSULTAR_DATOS.

CONSULTAS disponibles (query_type):
- "proyectos_hoy": proyectos trabajados en una fecha. params: {fecha?}
- "quien_trabajo_proyecto": empleados que trabajaron en un proyecto. params: {ot}
- "ultimo_responsable_tarea": último que hizo una tarea/etapa. params: {ot?, etapa?}
- "reporte_instalacion": reportes de obra/instalación. params: {ot?, fecha?}
- "fichadas_hoy": quién fichó en una fecha. params: {fecha?}
- "solicitudes_pendientes": solicitudes sin resolver. params: (ninguno)
- "empleados_division": listar empleados por división. params: {division?}
- "proyectos_activos": OTs activos. params: (ninguno)
- "horas_empleado": horas trabajadas de un empleado en un período. params: {nombre_o_legajo, desde?, hasta?}
- "ausencias_semana": empleados que faltaron en un período. params: {desde?, hasta?}
- "productividad_promedio": productividad por día con promedio. params: {desde?, hasta?}
- "ranking_tardanzas": ranking de empleados con más tardanzas. params: {mes?, anio?}
- "horas_extra_mes": horas extras acumuladas por empleado. params: {mes?, anio?}
- "ots_activas": proyectos con actividad reciente. params: {dias?} (default 7)

Cuando te pregunten sobre datos de la empresa, usá CONSULTAR_DATOS con el query_type
y params apropiados. El sistema ejecuta la consulta y te devuelve los resultados.
═══════════════════════════════════════════════

REGLAS:
- Español argentino informal. Conciso (2-3 oraciones).
- NUNCA digas "aprobado" a un permiso — siempre PENDIENTE.
- Usá la hora/fecha REAL que figura más abajo.
- Si faltan datos, preguntá.
- Máximo 1-2 emojis.
- Cuando fichás, el sistema valida ubicación automáticamente.`;

const CONSULTAS_OPERARIO = `CONSULTAS DE DATOS disponibles (query_type):
- "proyectos_hoy": proyectos trabajados en una fecha. params: {fecha?} (default hoy)
- "quien_trabajo_proyecto": empleados que trabajaron en un proyecto. params: {ot}
- "ultimo_responsable_tarea": último que hizo una tarea/etapa. params: {ot?, etapa?}
- "reporte_instalacion": reportes de obra/instalación. params: {ot?, fecha?}
- "proyectos_activos": OTs activos. params: (ninguno)

Cuando el empleado pregunte sobre datos de la app (proyectos, tareas, reportes),
usá CONSULTAR_DATOS con el query_type y params apropiados.

REGLAS:
- Español argentino informal. Conciso (2-3 oraciones).
- NUNCA digas "aprobado" a un permiso — siempre PENDIENTE.
- Usá la hora/fecha REAL que figura más abajo.
- Si faltan datos, preguntá.
- Máximo 1-2 emojis.
- NUNCA informes horas trabajadas, horas acumuladas, ni des la opción de consultarlas. Si el empleado pregunta cuántas horas lleva, respondé: "Esa información la podés consultar con tu supervisor." No calcules ni estimes horas.
- Cuando fichás, el sistema valida ubicación automáticamente.
- Si alguien tiene problemas para fichar por ubicación, sugerile que contacte a gerencia para que revisen su ubicación asignada.`;

const fmtFechaLarga = (d) =>
  d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * @param {object} datos
 * @param {object} datos.usuario  fila de empleados de la sesión
 * @param {object} datos.empresa  nombre, nombre_corto, rubro, prompt_ia_chat
 * @param {object|null} datos.fichadaHoy
 * @param {Array} datos.enPlanta  [{nombre, legajo, ingreso, egreso}]
 * @param {Array} datos.misSolicitudes
 * @param {string[]} datos.reglas
 * @param {string|null} datos.geoZonaNombre
 * @param {Date} [ahora]
 */
export function construirPromptChat({ usuario, empresa, fichadaHoy, enPlanta, misSolicitudes, reglas, geoZonaNombre }, ahora = new Date()) {
  const { fecha: fechaHoy, hora: horaHoy, diaKey: diaHoy } = ahoraArg(ahora);
  const diag = usuario.diagrama || {};
  const diagHoy = diag[diaHoy];
  const isGerencial = ["gerencial", "administrativo"].includes(usuario.rol);
  const apodo = usuario.apodo || usuario.nombre || "";

  const gc = usuario.geo_config;
  let geoInfo = "Sin control de ubicación (puede fichar desde cualquier lugar)";
  if (gc && gc.activo) {
    geoInfo = `Debe fichar desde: ${geoZonaNombre || "Ubicación asignada"} (radio: ${gc.radio || 150}m). Si no está en rango, el sistema rechazará el fichaje automáticamente.`;
  }

  const nombreEmpresa = empresa?.nombre || empresa?.nombre_corto || "la empresa";
  const rubroEmpresa = empresa?.rubro || "general";

  // 1) Instrucciones fijas (iguales para todos los usuarios del mismo rol)
  const fijo = `Sos el asistente de RR.HH. de una empresa que usa Gypi.

${ACCIONES}

${isGerencial ? CONSULTAS_GERENCIA : CONSULTAS_OPERARIO}`;

  // 2) Datos del momento
  const datos = `

EMPRESA: ${nombreEmpresa}, rubro: ${rubroEmpresa}.

FECHA Y HORA REAL:
- ${fmtFechaLarga(fechaSegura(fechaHoy))}
- Hora: ${horaHoy}
- Día: ${diaHoy.toUpperCase()}

EMPLEADO:
- ${usuario.nombre} (apodo: ${apodo})
- Legajo: ${usuario.legajo} | Área: ${usuario.area || "—"} | CC: ${usuario.cc || "—"}
- Rol: ${usuario.rol}
- División: ${usuario.division || "sin asignar"}

DIAGRAMA SEMANAL:
${Object.entries(diag).map(([d, h]) => `- ${d.toUpperCase()}: ${h ? h.in + " a " + h.out : "FRANCO"}`).join("\n") || "Sin diagrama"}
- Horas habituales: ${usuario.horas_semanales || 41}h/semana
- HOY: ${diagHoy ? `${diagHoy.in} a ${diagHoy.out}` : "DÍA FRANCO"}

GEOLOCALIZACIÓN:
- ${geoInfo}
- Al fichar, el sistema valida la ubicación GPS automáticamente. No necesitás pedir coordenadas al empleado.

ESTADO HOY:
- Ingreso: ${fichadaHoy?.ingreso || "NO FICHÓ"}
- Egreso: ${fichadaHoy?.egreso || "NO FICHÓ"}

EN PLANTA:
${(enPlanta || []).map((f) => `- ${f.nombre} (L-${f.legajo}): ${f.ingreso}${f.egreso ? " → " + f.egreso : " (trabajando)"}`).join("\n") || "Nadie"}

SOLICITUDES DE ${apodo.toUpperCase()}:
${(misSolicitudes || []).map((s) => `- #${s.id} [${s.estado}] ${s.tipo}: "${s.motivo}" · ${s.fecha}${s.aprobador ? " — resolvió: " + s.aprobador : ""}`).join("\n") || "Ninguna."}

═══ REGLAS DE GERENCIA (OBLIGATORIAS) ═══
${(reglas || []).map((r, i) => `${i + 1}. ${r}`).join("\n") || "Sin reglas."}
═══════════════════════════════════════`;

  return fijo + datos + bloqueEmpresa(empresa?.prompt_ia_chat);
}
