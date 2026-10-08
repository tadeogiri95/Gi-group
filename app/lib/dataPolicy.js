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

// Tipos de solicitud que acepta /api/data. hora_extra (F1-06) y
// salida_anticipada (D22) los crea el chat y antes se rechazaban con 400.
export const TIPOS_SOLICITUD = ["permiso", "vacaciones", "justificacion", "tardanza", "ausencia", "cambio_horario", "hora_extra", "salida_anticipada", "otro"];

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
  plantas:                      { GET: "all" },   // se editan por /api/config-empresa
  empresa:                      { GET: "all",     PATCH: "gestion" },

  // Solo gestión.
  config_sistema:               { GET: "gestion", POST: "gestion", PATCH: "gestion" },
  notas_calendario:             { GET: "gestion", POST: "gestion", PATCH: "gestion", DELETE: "gestion" },
  geo_registros:                { GET: "gestion" },
  v_resumen_diario:             { GET: "gestion" },
  v_scores_empleados:           { GET: "gestion" },
  // Facturación: solo el dueño (D2)
  suscripciones:                { GET: "dueno" },
  pagos:                        { GET: "dueno" },

  // invitaciones_empresa: sin uso en la app → todo prohibido (no figura).
};

// Campos de empresa que definen el comportamiento de la IA: solo el dueño.
export const CAMPOS_EMPRESA_SOLO_DUENO = ["prompt_ia_obra", "prompt_ia_chat", "reglas_asistencia"];

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
  if (tabla === "registro_actividades") {
    const err = validarActividad(out);
    if (err) return { status: 400, error: err };
  }
  if (tabla === "notificaciones" && !ROLES_GESTION.has(sesion?.rol) && out.destinatario_rol !== "gerencial") {
    return { status: 403, error: "Solo podés enviar avisos a gerencia" };
  }
  return { body: out };
}

// Valores que entiende la pantalla de gerencia (gerencia_actividad_screen.jsx)
export const TIPOS_ACTIVIDAD = new Set(["N", "R", "E", "C"]); // normal, retrabajo, error, cambio
export const CAUSAS_IMPRODUCTIVO = new Set(["M", "H", "I", "O"]); // material, herramienta, indicación, otro

/** Normaliza y valida tipo/causa/division de un registro de actividad (F1-02). Muta `body`. */
function validarActividad(body) {
  if (body.tipo === undefined || body.tipo === null) body.tipo = "N";
  if (!TIPOS_ACTIVIDAD.has(body.tipo)) return "Tipo de actividad inválido";
  if (body.causa === undefined || body.causa === "") body.causa = null;
  if (body.causa !== null) {
    if (!CAUSAS_IMPRODUCTIVO.has(body.causa)) return "Causa inválida";
    if (Number(body.etapa) !== 0) return "La causa solo aplica al tiempo improductivo";
  }
  if (body.division !== undefined && body.division !== null && (typeof body.division !== "string" || body.division.length > 50)) {
    return "División inválida";
  }
  return null;
}

/** Restricciones de campos por rol en PATCH. Devuelve null si está OK, o { status, error }. */
export function validarPatch(tabla, body, sesion) {
  if (tabla === "empresa" && sesion?.rol !== "gerencial") {
    const prohibido = CAMPOS_EMPRESA_SOLO_DUENO.find((c) => body && body[c] !== undefined);
    if (prohibido) return { status: 403, error: "Solo el dueño de la cuenta puede cambiar las instrucciones de la IA" };
  }
  return null;
}

// ═══ Consultas: columnas sensibles, embebidos y referencias (auditoría F2-02) ═══

// Columnas que nunca se pueden pedir, filtrar ni ordenar por el gateway
// (aunque se quiten de la respuesta, filtrar por ellas permitiría deducirlas).
const COLUMNAS_SENSIBLES = [
  "password", "password_reset_jti", "admin_password",
  "email_verify_token", "email_verify_expires",
  "token_hash", "jti", "refresh_jti", "activacion_codigo_hash",
  "pin_hash", "pin_intentos", "pin_bloqueado_hasta",
];
const RE_SENSIBLE = new RegExp(`(^|[^a-z0-9_])(${COLUMNAS_SENSIBLES.join("|")})([^a-z0-9_]|$)`, "i");

// Datos relacionados (embebidos de PostgREST) permitidos, por tabla:
// relación → columnas que se pueden traer de ella.
export const EMBEDS_PERMITIDOS = {
  fichadas: { empleados: new Set(["nombre", "division", "apodo"]) },
};

const RE_COLUMNA = /^(?:[a-z_][a-z0-9_]*:)?(?:\*|[a-z_][a-z0-9_]*)(?:::[a-z]+)?$/i;

function partirTopLevel(s) {
  const partes = [];
  let nivel = 0, actual = "";
  for (const ch of s) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) { partes.push(actual); actual = ""; continue; }
    actual += ch;
  }
  partes.push(actual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

function validarSelect(tabla, select) {
  for (const parte of partirTopLevel(select)) {
    if (RE_COLUMNA.test(parte)) continue;
    const m = parte.match(/^([a-z_][a-z0-9_]*)\(([^()]*)\)$/i);
    const permitidas = m && EMBEDS_PERMITIDOS[tabla]?.[m[1]];
    if (!permitidas) return `No se pueden consultar datos relacionados ("${parte}")`;
    const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0 || cols.some((c) => !permitidas.has(c))) {
      return `Columnas no permitidas en "${m[1]}"`;
    }
  }
  return null;
}

/**
 * Valida el path de una consulta del gateway. Devuelve un mensaje de error o null.
 * - Ninguna columna sensible en select, filtros ni orden.
 * - Embebidos solo desde la lista permitida y con columnas permitidas.
 * - Sin filtros sobre tablas relacionadas (claves con punto).
 */
export function validarConsulta(tabla, path) {
  const q = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  if (!q) return null;
  let decoded;
  try { decoded = decodeURIComponent(q); } catch { return "Consulta mal formada"; }
  if (RE_SENSIBLE.test(decoded)) return "La consulta incluye columnas no permitidas";
  for (const par of q.split("&")) {
    if (!par) continue;
    const i = par.indexOf("=");
    let clave, valor;
    try {
      clave = decodeURIComponent(i === -1 ? par : par.slice(0, i));
      valor = i === -1 ? "" : decodeURIComponent(par.slice(i + 1));
    } catch { return "Consulta mal formada"; }
    if (clave.includes(".")) return "No se puede filtrar por datos relacionados";
    if (clave === "select") {
      const err = validarSelect(tabla, valor);
      if (err) return err;
    }
  }
  return null;
}

// Referencias (FK) que llegan en el body y deben pertenecer a la misma empresa.
export const REFERENCIAS = {
  empleado_id: "empleados",
  tipo_documento_id: "tipos_documento_requerido",
  planta_id: "plantas",
};
