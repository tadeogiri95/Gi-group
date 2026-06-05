// ═══════════════════════════════════════════════════════════
// /api/data/route.js — VERSIÓN SEGURA (multi-tenant blindado)
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// (antes estaba duplicado inline acá).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validarLimite, invalidarCachePlan } from "../../lib/planEnforcement";

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
  "reglas_bot", "catalogo_etapas", "registro_actividades",
  "reportes_obra", "proyectos", "push_subscriptions", "push_tokens",
  "v_resumen_diario", "geo_zonas", "geo_registros",
  "config_sistema", "notas_calendario", "mensajes_chat",
  "etapas", "divisiones", "empresa", "invitaciones_empresa",
  "suscripciones", "pagos",
];

const TABLAS_SOLO_LECTURA = ["v_resumen_diario"];

const TABLAS_CON_EMPRESA = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "registro_actividades", "reportes_obra", "push_subscriptions", "push_tokens",
  "config_sistema", "notas_calendario", "mensajes_chat",
  "etapas", "divisiones", "geo_zonas", "geo_registros",
  "v_resumen_diario", "reglas_bot",
  "proyectos", "invitaciones_empresa",
  "suscripciones", "pagos",
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
      if (body.rol && method === "PATCH") {
        return { valido: false, error: "No se puede cambiar el rol desde la app" };
      }
      break;
    case "registro_actividades":
      if (method === "POST") {
        if (!body.empleado_id || body.etapa === undefined) {
          return { valido: false, error: "Actividad requiere empleado_id y etapa" };
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
      console.error("[data] Falta configuración: SUPABASE_URL o SUPABASE_SERVICE_KEY");
      return NextResponse.json({ error: "Servidor mal configurado" }, { status: 500 });
    }

    const { method, path, body } = await request.json();
    if (!path) {
      return NextResponse.json({ error: "Path requerido" }, { status: 400 });
    }

    // ─── AUTENTICACIÓN (ahora desde lib/auth.js) ───
    const sesion = await validarToken(request);
    if (!sesion || !sesion.empresa_id) {
      return respuestaNoAutorizado();
    }
    const empresaId = sesion.empresa_id;

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
    if (method === "POST" || method === "PATCH") {
      finalBody = inyectarEmpresaEnBody(body, pathCheck.tabla, empresaId, method);
    }

    // ─── EJECUTAR ───
    const opts = {};
    if (method === "POST") { opts.method = "POST"; opts.body = JSON.stringify(finalBody); }
    else if (method === "PATCH") { opts.method = "PATCH"; opts.body = JSON.stringify(finalBody); }
    else if (method === "DELETE") { opts.method = "DELETE"; }

    const data = await sbFetch(finalPath, opts);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[data] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
