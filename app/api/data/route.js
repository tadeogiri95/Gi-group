// ═══════════════════════════════════════════════════════════
// /api/data/route.js — VERSIÓN SEGURA (multi-tenant blindado)
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// (antes estaba duplicado inline acá).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validarLimite, invalidarCachePlan } from "../../lib/planEnforcement";
import { broadcastRefresh } from "../../lib/broadcast";
import { logger } from "../../lib/logger";
import { stripUnallowedFields, sanitizePostgrestParam, safeErrorMessage } from "../../lib/validate";
import { checkRateLimit } from "../../lib/rateLimitMemory";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ═══ VALIDACIONES ═══

const TABLAS_PERMITIDAS = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "reglas_bot", "registro_actividades",
  "reportes_obra", "proyectos", "push_tokens",
  "v_resumen_diario", "v_scores_empleados", "geo_zonas", "geo_registros",
  "config_sistema", "notas_calendario", "mensajes_chat", "turnos_planificados",
  "etapas", "divisiones", "empresa", "invitaciones_empresa",
  "suscripciones", "pagos",
  "tipos_documento_requerido", "documentos_exigidos_empleado", "documentos_empleado",
];

// documentos_empleado: solo lectura vía /api/data — los inserts pasan SIEMPRE
// por /api/documentos/upload (valida tipo/tamaño de archivo server-side antes
// de escribir la fila). Sin esto, un POST directo podría crear filas con
// storage_path arbitrario sin que exista el archivo.
const TABLAS_SOLO_LECTURA = ["v_resumen_diario", "v_scores_empleados", "documentos_empleado"];

const CAMPOS_EXCLUIDOS = {
  empleados: ["password", "password_reset_jti"],
  empresa:   ["admin_password", "email_verify_token", "email_verify_expires"],
};

function filtrarCamposSensibles(data, tabla) {
  const excluidos = CAMPOS_EXCLUIDOS[tabla];
  if (!excluidos || !data) return data;
  if (Array.isArray(data)) {
    return data.map((row) => {
      if (!row || typeof row !== "object") return row;
      const clean = { ...row };
      for (const campo of excluidos) delete clean[campo];
      return clean;
    });
  }
  if (typeof data === "object") {
    const clean = { ...data };
    for (const campo of excluidos) delete clean[campo];
    return clean;
  }
  return data;
}

const TABLAS_CON_EMPRESA = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "registro_actividades", "reportes_obra", "push_tokens",
  "config_sistema", "notas_calendario", "mensajes_chat", "turnos_planificados",
  "etapas", "divisiones", "geo_zonas", "geo_registros",
  "v_resumen_diario", "v_scores_empleados", "reglas_bot",
  "proyectos", "invitaciones_empresa",
  "suscripciones", "pagos",
  "tipos_documento_requerido", "documentos_exigidos_empleado", "documentos_empleado",
];

function validarPath(path) {
  if (/[;'"\\]|--/.test(path)) {
    return { valido: false, error: "Caracteres no permitidos en la consulta" };
  }
  const tabla = path.split("?")[0].split("/")[0];
  if (!TABLAS_PERMITIDAS.includes(tabla)) {
    return { valido: false, error: `Tabla "${tabla}" no permitida` };
  }
  return { valido: true, tabla };
}

function validarBody(tabla, body, method) {
  if (!body || typeof body !== "object") {
    return { valido: false, error: "Body inválido" };
  }
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("__")) {
      return { valido: false, error: `Campo "${key}" no permitido` };
    }
    if (typeof value === "string" && value.length > 100000) {
      return { valido: false, error: `Campo "${key}" excede el largo máximo` };
    }
  }

  switch (tabla) {
    case "fichadas":
      if (method === "POST") {
        if (!body.legajo || !body.fecha) {
          return { valido: false, error: "Fichada requiere legajo y fecha" };
        }
        const horaRe = /^\d{2}:\d{2}$/;
        if (body.ingreso && !horaRe.test(body.ingreso)) {
          return { valido: false, error: "Formato de hora inválido para ingreso" };
        }
        if (body.egreso && !horaRe.test(body.egreso)) {
          return { valido: false, error: "Formato de hora inválido para egreso" };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
          return { valido: false, error: "Formato de fecha inválido" };
        }
      }
      break;
    case "solicitudes":
      if (method === "POST") {
        if (!body.legajo || !body.tipo) {
          return { valido: false, error: "Solicitud requiere legajo y tipo" };
        }
        const tiposValidos = ["permiso", "vacaciones", "justificacion", "tardanza", "ausencia", "cambio_horario", "otro"];
        if (!tiposValidos.includes(body.tipo)) {
          return { valido: false, error: `Tipo de solicitud inválido` };
        }
      }
      break;
    case "notificaciones":
      if (method === "POST") {
        if (!body.destinatario_rol || !body.tipo || !body.asunto) {
          return { valido: false, error: "Notificación requiere destinatario_rol, tipo y asunto" };
        }
      }
      break;
    case "empleados":
      if (method === "POST") {
        if (!body.legajo || !body.nombre) {
          return { valido: false, error: "Empleado requiere legajo y nombre" };
        }
      }
      break;
    case "registro_actividades":
      if (method === "POST") {
        if (!body.empleado_id || body.etapa === undefined) {
          return { valido: false, error: "Actividad requiere empleado_id y etapa" };
        }
      }
      break;
    case "turnos_planificados":
      if (method === "POST") {
        if (!body.empleado_id || !body.fecha || !body.hora_inicio || !body.hora_fin) {
          return { valido: false, error: "Turno requiere empleado_id, fecha, hora_inicio y hora_fin" };
        }
      }
      break;
  }
  return { valido: true };
}

function inyectarEmpresaEnGet(path, tabla, empresaId) {
  if (!TABLAS_CON_EMPRESA.includes(tabla) && tabla !== "empresa") return path;
  const filtro = tabla === "empresa" ? `id=eq.${empresaId}` : `empresa_id=eq.${empresaId}`;
  const re = tabla === "empresa" ? /id=eq\.[a-zA-Z0-9-]+/ : /empresa_id=eq\.[a-zA-Z0-9-]+/;
  if (re.test(path)) {
    return path.replace(re, filtro);
  }
  if (path.includes("?")) return path + `&${filtro}`;
  return path + `?${filtro}`;
}

// Garantiza que toda query GET tenga un límite explícito (máx 1000).
// Evita que un solo request traiga decenas de miles de filas.
const LIMIT_DEFAULT = 500;
const LIMIT_MAX = 1000;

function inyectarLimit(path, limit, offset) {
  const cap = Math.min(Math.max(1, limit || LIMIT_DEFAULT), LIMIT_MAX);
  // Si el path ya lleva limit= lo respetamos (el cliente sabe lo que pide),
  // pero lo capeamos al máximo de todas formas.
  if (/\blimit=\d+/.test(path)) {
    path = path.replace(/\blimit=(\d+)/, (_, n) => `limit=${Math.min(Number(n), LIMIT_MAX)}`);
  } else {
    path += (path.includes("?") ? "&" : "?") + `limit=${cap}`;
  }
  if (offset && offset > 0) {
    if (!/\boffset=\d+/.test(path)) {
      path += `&offset=${offset}`;
    }
  }
  return path;
}

// Paginación keyset (cursor) — alternativa a offset para tablas de alto
// volumen. Requiere que el GET tenga un `order=columna.dir` explícito:
// el cursor es el valor de esa columna en la última fila de la página
// anterior. Evita el costo de OFFSET (que obliga a Postgres a escanear y
// descartar todas las filas saltadas) a cambio de no poder "saltar" a una
// página arbitraria — solo "siguiente página" desde el último cursor visto.
function extraerOrden(path) {
  const m = path.match(/(?:\?|&)order=([a-zA-Z_][a-zA-Z0-9_]*)\.(asc|desc)/);
  return m ? { columna: m[1], direccion: m[2] } : null;
}

function inyectarCursor(path, cursor) {
  if (!cursor) return path;
  const orden = extraerOrden(path);
  if (!orden) return path; // sin order= explícito no hay forma segura de aplicar cursor
  const op = orden.direccion === "desc" ? "lt" : "gt";
  const filtro = `${orden.columna}=${op}.${encodeURIComponent(cursor)}`;
  return path + (path.includes("?") ? "&" : "?") + filtro;
}

function inyectarEmpresaEnBody(body, tabla, empresaId, method) {
  if (!TABLAS_CON_EMPRESA.includes(tabla)) return body;
  if (!body) return body;
  if (method === "POST" || method === "PATCH") {
    return { ...body, empresa_id: empresaId };
  }
  return body;
}

// ═══ POST /api/data ═══
export async function POST(request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      logger.error("[data] Falta configuración: SUPABASE_URL o SUPABASE_SERVICE_KEY");
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const { method, path, body, limit, offset, cursor } = await request.json();
    if (!path) {
      return NextResponse.json({ error: "Path requerido" }, { status: 400 });
    }

    // ─── AUTENTICACIÓN (ahora desde lib/auth.js) ───
    const sesion = await validarToken(request);
    if (!sesion || !sesion.empresa_id) {
      return respuestaNoAutorizado();
    }
    const empresaId = sesion.empresa_id;

    // ─── RATE LIMIT (60 writes/min por empresa, reads ilimitados) ───
    if (method && method !== "GET") {
      const rl = checkRateLimit(`data:${empresaId}`, 60, 60_000);
      if (rl.limited) {
        return NextResponse.json(
          { error: "Demasiadas operaciones. Esperá unos segundos." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
        );
      }
    }

    // ─── VALIDACIONES ───
    const pathCheck = validarPath(path);
    if (!pathCheck.valido) {
      return NextResponse.json({ error: pathCheck.error }, { status: 403 });
    }

    if (TABLAS_SOLO_LECTURA.includes(pathCheck.tabla) && method && method !== "GET") {
      return NextResponse.json({ error: `Tabla "${pathCheck.tabla}" es de solo lectura` }, { status: 403 });
    }

    if ((method === "POST" || method === "PATCH") && body) {
      const bodyCheck = validarBody(pathCheck.tabla, body, method);
      if (!bodyCheck.valido) {
        return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
      }
    }

    // ─── Enforcement de límites por plan ───
    if (method === "POST") {
      const limCheck = await validarLimite({
        tabla: pathCheck.tabla,
        empresaId,
        body,
        method,
      });
      if (!limCheck.ok) {
        return NextResponse.json(
          { error: limCheck.error, upgrade_a: limCheck.upgrade_a, paywall: true },
          { status: 402 }
        );
      }
    }

    if (pathCheck.tabla === "empresa" && (method === "PATCH" || method === "POST")) {
      invalidarCachePlan(empresaId);
    }

    // ─── INYECTAR empresa_id de la SESIÓN ───
    let finalPath = path;
    let finalBody = body;

    if (!method || method === "GET" || method === "PATCH" || method === "DELETE") {
      finalPath = inyectarEmpresaEnGet(path, pathCheck.tabla, empresaId);
    }
    // Aplicar paginación a todo GET para evitar retornos sin límite.
    // Si viene `cursor`, se usa keyset (ignora offset); si no, offset clásico.
    if (!method || method === "GET") {
      if (cursor) {
        const safeCursor = sanitizePostgrestParam(String(cursor));
        finalPath = inyectarCursor(finalPath, safeCursor);
      }
      finalPath = inyectarLimit(finalPath, limit, cursor ? 0 : offset);
    }
    if (method === "POST" || method === "PATCH") {
      finalBody = stripUnallowedFields(body, pathCheck.tabla, method);
      finalBody = inyectarEmpresaEnBody(finalBody, pathCheck.tabla, empresaId, method);
    }

    // ─── EJECUTAR ───
    const opts = {};
    if (method === "POST") { opts.method = "POST"; opts.body = JSON.stringify(finalBody); }
    else if (method === "PATCH") { opts.method = "PATCH"; opts.body = JSON.stringify(finalBody); }
    else if (method === "DELETE") { opts.method = "DELETE"; }

    const data = await sbFetch(finalPath, opts);

    // Broadcast de cambios para tablas monitoreadas en tiempo real
    const BROADCAST_EN = ["solicitudes", "notificaciones", "registro_actividades"];
    if (BROADCAST_EN.includes(pathCheck.tabla) && method && method !== "GET") {
      broadcastRefresh(empresaId, pathCheck.tabla);
    }

    // nextCursor: valor de la columna de orden en la última fila — el cliente
    // lo reenvía como `cursor` para pedir la página siguiente sin OFFSET.
    let nextCursor = null;
    if ((!method || method === "GET") && Array.isArray(data) && data.length > 0) {
      const orden = extraerOrden(finalPath);
      if (orden && data[data.length - 1]?.[orden.columna] !== undefined) {
        nextCursor = data[data.length - 1][orden.columna];
      }
    }

    return NextResponse.json({ ok: true, data: filtrarCamposSensibles(data, pathCheck.tabla), nextCursor });
  } catch (err) {
    logger.error("[data] Error interno", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
