import { NextResponse } from "next/server";

// ─── Supabase server-side ───
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
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ═══ VALIDACIONES ═══

// Tablas permitidas (whitelist)
const TABLAS_PERMITIDAS = [
  "empleados", "fichadas", "solicitudes", "notificaciones",
  "reglas_bot", "catalogo_etapas", "registro_actividades",
  "reportes_obra", "proyectos", "push_subscriptions",
  "v_resumen_diario", "geo_zonas", "geo_registros",
  // ── Tablas agregadas en Fase 5 ──
  "config_sistema", "notas_calendario", "mensajes_chat",
  "etapas", "divisiones", "empresa",
];

// Tablas de solo lectura (no se pueden POST/PATCH/DELETE)
const TABLAS_SOLO_LECTURA = [
  "v_resumen_diario",
];

// Validar que el path no tenga inyección SQL o caracteres peligrosos
function validarPath(path) {
  // No permitir punto y coma, comillas, comentarios SQL
  if (/[;'"\\]|--/.test(path)) {
    return { valido: false, error: "Caracteres no permitidos en la consulta" };
  }
  // Extraer nombre de tabla
  const tabla = path.split("?")[0].split("/")[0];
  if (!TABLAS_PERMITIDAS.includes(tabla)) {
    return { valido: false, error: `Tabla "${tabla}" no permitida` };
  }
  return { valido: true, tabla };
}

// Validar body de POST/PATCH según la tabla
function validarBody(tabla, body, method) {
  if (!body || typeof body !== "object") {
    return { valido: false, error: "Body inválido" };
  }

  // No permitir campos que empiecen con "__" o contengan scripts
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("__")) {
      return { valido: false, error: `Campo "${key}" no permitido` };
    }
    if (typeof value === "string" && value.length > 10000) {
      return { valido: false, error: `Campo "${key}" excede el largo máximo (10000 caracteres)` };
    }
  }

  // Validaciones específicas por tabla
  switch (tabla) {
    case "fichadas":
      if (method === "POST") {
        if (!body.legajo || !body.fecha) {
          return { valido: false, error: "Fichada requiere legajo y fecha" };
        }
        const horaRe = /^\d{2}:\d{2}$/;
        if (body.ingreso && !horaRe.test(body.ingreso)) {
          return { valido: false, error: "Formato de hora inválido para ingreso (usar HH:MM)" };
        }
        if (body.egreso && !horaRe.test(body.egreso)) {
          return { valido: false, error: "Formato de hora inválido para egreso (usar HH:MM)" };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
          return { valido: false, error: "Formato de fecha inválido (usar YYYY-MM-DD)" };
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
          return { valido: false, error: `Tipo de solicitud inválido. Usar: ${tiposValidos.join(", ")}` };
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
      // Nunca permitir cambiar el rol desde el cliente
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

// ─── POST /api/data ───
export async function POST(request) {
  try {
    const { method, path, body } = await request.json();

    if (!path) {
      return NextResponse.json({ error: "Path requerido" }, { status: 400 });
    }

    // Validar path y tabla
    const pathCheck = validarPath(path);
    if (!pathCheck.valido) {
      return NextResponse.json({ error: pathCheck.error }, { status: 403 });
    }

    // Verificar solo lectura
    if (TABLAS_SOLO_LECTURA.includes(pathCheck.tabla) && method !== "GET") {
      return NextResponse.json({ error: `Tabla "${pathCheck.tabla}" es de solo lectura` }, { status: 403 });
    }

    // Validar body en POST/PATCH
    if ((method === "POST" || method === "PATCH") && body) {
      const bodyCheck = validarBody(pathCheck.tabla, body, method);
      if (!bodyCheck.valido) {
        return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
      }
    }

    // Ejecutar la operación
    const opts = {};
    if (method === "POST") {
      opts.method = "POST";
      opts.body = JSON.stringify(body);
    } else if (method === "PATCH") {
      opts.method = "PATCH";
      opts.body = JSON.stringify(body);
    } else if (method === "DELETE") {
      opts.method = "DELETE";
    }

    const data = await sbFetch(path, opts);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[data] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
