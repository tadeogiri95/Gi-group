// ═══════════════════════════════════════════════════════════
// app/lib/dataPolicy.js — Permisos por rol del gateway /api/data
//
// Deny-by-default: una tabla o método que no figura acá se rechaza.
// Reglas posibles por método:
//   "all"     → cualquier usuario logueado de la empresa
//   "gestion" → gerencial o administrativo
//   "dueno"   → solo gerencial
//   "own"     → gestión sin restricción; operativo solo sus propias filas
//               (se agrega un filtro por la columna `own` con el valor de su sesión)
//   "self"    → todos los roles, siempre restringidos a sus propias filas
//   (sin regla) → prohibido
//
// En POST, las reglas "own"/"self" además fuerzan en el body las columnas
// de identidad (empleado_id / legajo) con los valores de la sesión.
//
// Auditoría: F2-01 (sin control de rol) y F2-07 (datos de compañeros
// legibles por cualquier rol).
// ═══════════════════════════════════════════════════════════

export const ROLES_GESTION = new Set(["gerencial", "administrativo"]);

// own: columna que identifica al dueño de la fila y de qué dato de la sesión sale.
const OWN_EMPLEADO = { col: "empleado_id", from: "empleado_id" };
const OWN_LEGAJO = { col: "legajo", from: "legajo" };
const OWN_DESTINATARIO = { col: "destinatario_rol", from: "legajo" };
const OWN_ID = { col: "id", from: "empleado_id" };

export const POLICY = {
  empleados:                    { own: OWN_ID,           GET: "own",     PATCH: "gestion" },
  fichadas:                     { own: OWN_LEGAJO,       GET: "own",     POST: "gestion", PATCH: "gestion" },
  solicitudes:                  { own: OWN_LEGAJO,       GET: "own",     POST: "own",     PATCH: "gestion" },
  notificaciones:               { own: OWN_DESTINATARIO, GET: "own",     POST: "all",     PATCH: "own" },
  registro_actividades:         { own: OWN_EMPLEADO,     GET: "own",     POST: "own",     PATCH: "own" },
  reportes_obra:                { own: OWN_LEGAJO,       GET: "own",     POST: "own",     PATCH: "gestion" },
  mensajes_chat:                { own: OWN_EMPLEADO,     GET: "own",     POST: "self" },
  push_tokens:                  { own: OWN_LEGAJO,       GET: "self",    POST: "self",    PATCH: "self", DELETE: "self" },
  turnos_planificados:          { own: OWN_EMPLEADO,     GET: "own",     POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  documentos_exigidos_empleado: { own: OWN_EMPLEADO,     GET: "own",     POST: "gestion", DELETE: "gestion" },
  documentos_empleado:          { own: OWN_EMPLEADO,     GET: "own" },

  // Catálogos de la empresa: lectura para todos, escritura de gestión.
  proyectos:                    { GET: "all",     POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  geo_zonas:                    { GET: "all",     POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  reglas_bot:                   { GET: "all",     POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  tipos_documento_requerido:    { GET: "all",     POST: "gestion", PATCH: "gestion" },
  etapas:                       { GET: "all" },   // se editan por /api/config-empresa
  divisiones:                   { GET: "all" },   // se editan por /api/config-empresa
  empresa:                      { GET: "all",     PATCH: "gestion" },

  // Solo gestión.
  config_sistema:               { GET: "gestion", POST: "gestion", PATCH: "gestion" },
  notas_calendario:             { GET: "gestion", POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  geo_registros:                { GET: "gestion" },
  v_resumen_diario:             { GET: "gestion" },
  v_scores_empleados:           { GET: "gestion" },
  suscripciones:                { GET: "gestion" },
  pagos:                        { GET: "gestion" },

  // invitaciones_empresa: sin uso en la app → todo prohibido (no figura).
};

// Campos de empresa que definen el comportamiento de la IA: solo el dueño.
export const CAMPOS_EMPRESA_SOLO_DUENO = ["prompt_ia_obra", "prompt_ia_chat"];

function valorSesion(sesion, from) {
  const v = sesion?.[from];
  return v === undefined || v === null ? null : String(v);
}

/**
 * Decide si la sesión puede ejecutar `method` sobre `tabla`.
 * @returns {{ ok: true, ownFilter: null | { col: string, value: string } }
 *          | { ok: false, status: number, error: string }}
 */
export function autorizar(tabla, method, sesion) {
  const m = method || "GET";
  const pol = POLICY[tabla];
  const regla = pol?.[m];
  if (!regla) {
    return { ok: false, status: 403, error: `Operación no permitida sobre "${tabla}"` };
  }
  const esGestion = ROLES_GESTION.has(sesion?.rol);
  const esDueno = sesion?.rol === "gerencial";

  if (regla === "all") return { ok: true, ownFilter: null };
  if (regla === "gestion") {
    return esGestion
      ? { ok: true, ownFilter: null }
      : { ok: false, status: 403, error: "Tu rol no tiene permiso para esta acción" };
  }
  if (regla === "dueno") {
    return esDueno
      ? { ok: true, ownFilter: null }
      : { ok: false, status: 403, error: "Solo el dueño de la cuenta puede hacer esta acción" };
  }
  if (regla === "own" || regla === "self") {
    if (regla === "own" && esGestion) return { ok: true, ownFilter: null };
    const value = valorSesion(sesion, pol.own.from);
    if (!value) return { ok: false, status: 403, error: "Sesión sin identidad de empleado" };
    return { ok: true, ownFilter: { col: pol.own.col, value } };
  }
  return { ok: false, status: 403, error: "Operación no permitida" };
}

/** Agrega el filtro de filas propias a un path de PostgREST. */
export function aplicarFiltroPropio(path, ownFilter) {
  if (!ownFilter) return path;
  const filtro = `${ownFilter.col}=eq.${encodeURIComponent(ownFilter.value)}`;
  return path + (path.includes("?") ? "&" : "?") + filtro;
}

/**
 * Fuerza en el body de un POST las columnas de identidad del operativo y
 * aplica reglas de negocio mínimas. Devuelve { body } o { error, status }.
 */
export function prepararBodyPost(tabla, body, sesion, ownFilter) {
  const out = { ...body };
  if (ownFilter) {
    if (tabla === "registro_actividades" || tabla === "mensajes_chat") {
      out.empleado_id = sesion.empleado_id;
    }
    if (tabla === "registro_actividades" || tabla === "solicitudes" || tabla === "reportes_obra" || tabla === "push_tokens") {
      out.legajo = Number(sesion.legajo);
    }
    if (tabla === "solicitudes") {
      out.empleado_id = sesion.empleado_id;
      out.estado = "pendiente"; // nadie se autoaprueba al crear
    }
  }
  if (tabla === "notificaciones" && !ROLES_GESTION.has(sesion?.rol) && out.destinatario_rol !== "gerencial") {
    return { status: 403, error: "Solo podés enviar avisos a gerencia" };
  }
  return { body: out };
}

/** Restricciones de campos por rol en PATCH. Devuelve null si está OK, o { status, error }. */
export function validarPatch(tabla, body, sesion) {
  if (tabla === "empresa" && sesion?.rol !== "gerencial") {
    const prohibido = CAMPOS_EMPRESA_SOLO_DUENO.find((c) => body && body[c] !== undefined);
    if (prohibido) return { status: 403, error: "Solo el dueño de la cuenta puede cambiar las instrucciones de la IA" };
  }
  return null;
}
