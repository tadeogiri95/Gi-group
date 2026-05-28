// ═══════════════════════════════════════════════════════════
// /api/data/route.js — ETAPA 2: Proxy seguro con autenticación
// 
// Cambios respecto a la versión anterior:
// - Requiere token de sesión en cada request
// - Inyecta empresa_id automáticamente en GET y POST
// - El frontend NO puede falsear el empresa_id
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...opts.headers,
  };
  const res = await fetch(url, { ...headers, ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ─── Validar sesión contra la DB ───
async function validarToken(token) {
  if (!token || token.length < 20) return null;
  
  const url = `${SUPABASE_URL}/rest/v1/rpc/validar_sesion`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token: token }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

// ═══ VALIDACIONES ═══

const TABLAS_PERMITIDAS = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "reglas_bot", "catalogo_etapas", "registro_actividades",
  "reportes_obra", "proyectos", "push_subscriptions",
  "v_resumen_diario", "geo_zonas", "geo_registros",
  "config_sistema", "notas_calendario", "mensajes_chat",
  "etapas", "divisiones", "empresa",
];

const TABLAS_SOLO_LECTURA = ["v_resumen_diario"];

// Tablas que tienen empresa_id y deben filtrarse
const TABLAS_CON_EMPRESA = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "registro_actividades", "reportes_obra", "push_subscriptions",
  "config_sistema", "notas_calendario", "mensajes_chat",
  "etapas", "divisiones", "geo_zonas", "geo_registros",
  "v_resumen_diario",
];

// Tablas que NO tienen empresa_id (no se filtran)
// "empresa", "reglas_bot", "catalogo_etapas", "proyectos"

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
    if (typeof value === "string" && value.length > 10000) {
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
        const tiposValidos = ["permiso", "vacaciones", "justificacion", "tardanza", "ausencia", "otro"];
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

// ─── Inyectar empresa_id en queries GET ───
function inyectarEmpresaEnGet(path, tabla, empresaId) {
  if (!TABLAS_CON_EMPRESA.includes(tabla)) return path;
  
  const filtro = `empresa_id=eq.${empresaId}`;
  
  // Si ya tiene empresa_id en el query, reemplazarlo con el correcto
  if (path.includes("empresa_id=")) {
    return path.replace(/empresa_id=eq\.\d+/, filtro);
  }
  
  // Si tiene query params, agregar con &
  if (path.includes("?")) {
    return path + `&${filtro}`;
  }
  
  // Si no tiene query params, agregar con ?
  return path + `?${filtro}`;
}

// ─── Inyectar empresa_id en body de POST/PATCH ───
function inyectarEmpresaEnBody(body, tabla, empresaId, method) {
  if (!TABLAS_CON_EMPRESA.includes(tabla)) return body;
  if (!body) return body;
  
  // En POST siempre forzar el empresa_id correcto
  if (method === "POST") {
    return { ...body, empresa_id: empresaId };
  }
  
  // En PATCH no agregar empresa_id (no se cambia),
  // pero sí asegurarnos de que el query tenga el filtro
  return body;
}

// ═══ POST /api/data ═══
export async function POST(request) {
  try {
    const { method, path, body } = await request.json();

    if (!path) {
      return NextResponse.json({ error: "Path requerido" }, { status: 400 });
    }

    // ─── AUTENTICACIÓN ───
    // Leer token del header Authorization
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: "No autorizado — token faltante" }, { status: 401 });
    }

    const sesion = await validarToken(token);
    if (!sesion) {
      return NextResponse.json({ error: "Sesión inválida o expirada" }, { status: 401 });
    }

    const empresaId = sesion.empresa_id;

    // ─── VALIDACIONES ───
    const pathCheck = validarPath(path);
    if (!pathCheck.valido) {
      return NextResponse.json({ error: pathCheck.error }, { status: 403 });
    }

    if (TABLAS_SOLO_LECTURA.includes(pathCheck.tabla) && method !== "GET") {
      return NextResponse.json({ error: `Tabla "${pathCheck.tabla}" es de solo lectura` }, { status: 403 });
    }

    if ((method === "POST" || method === "PATCH") && body) {
      const bodyCheck = validarBody(pathCheck.tabla, body, method);
      if (!bodyCheck.valido) {
        return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
      }
    }

    // ─── INYECTAR empresa_id ───
    let finalPath = path;
    let finalBody = body;

    // En GET: agregar filtro empresa_id al query
    if (!method || method === "GET") {
      finalPath = inyectarEmpresaEnGet(path, pathCheck.tabla, empresaId);
    }

    // En POST/PATCH: forzar empresa_id en el body
    if (method === "POST" || method === "PATCH") {
      finalBody = inyectarEmpresaEnBody(body, pathCheck.tabla, empresaId, method);
    }

    // En PATCH/DELETE: agregar filtro empresa_id al path para que
    // no pueda modificar/borrar registros de otra empresa
    if (method === "PATCH" || method === "DELETE") {
      finalPath = inyectarEmpresaEnGet(path, pathCheck.tabla, empresaId);
    }

    // Tabla "empresa": solo puede leer SU propia empresa
    if (pathCheck.tabla === "empresa" && (!method || method === "GET")) {
      if (!finalPath.includes(`id=eq.${empresaId}`)) {
        finalPath = `empresa?id=eq.${empresaId}&select=*`;
      }
    }

    // ─── EJECUTAR ───
    const opts = {};
    if (method === "POST") {
      opts.method = "POST";
      opts.body = JSON.stringify(finalBody);
    } else if (method === "PATCH") {
      opts.method = "PATCH";
      opts.body = JSON.stringify(finalBody);
    } else if (method === "DELETE") {
      opts.method = "DELETE";
    }

    const data = await sbFetch(finalPath, opts);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[data] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
