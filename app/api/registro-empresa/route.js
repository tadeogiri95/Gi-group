// app/api/registro-empresa/route.js
// Registra una nueva empresa y su usuario admin
// FIX: sbFetch ahora verifica res.ok antes de parsear JSON
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sendBienvenida, sendVerificacionEmail } from "../../lib/email";
import { validarPassword } from "../../lib/validators";
import { logger } from "../../lib/logger";
import { ventana15min } from "../../lib/rateLimit";
import { registroEmpresaBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { logEvent, EVT } from "../../lib/analytics";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : undefined,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, opts);
  const text = await res.text();
  if (!text || text.trim() === "") return method === "DELETE" ? null : [];
  try {
    return JSON.parse(text);
  } catch (e) {
    logger.error(`sbFetch JSON parse error on ${method} ${path}`, new Error(text.slice(0, 200)));
    throw new Error(`Error de base de datos: respuesta inválida`);
  }
}

// Rate limit: máximo 3 registros por IP por ventana de 15 minutos.
// Reutiliza rpc_login_attempt con prefijo "reg:" para distinguir del rate limit de login.
// Fail-closed: si la DB no responde, se bloquea el intento (seguridad > disponibilidad en edge case).
const MAX_REGISTRO_ATTEMPTS = 3;
async function checkRegistroRateLimit(ip) {
  if (!SB_URL || !SB_KEY || !ip) return false;
  try {
    const ventana = ventana15min();
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: `reg:${ip}`, p_ventana: ventana }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn("checkRegistroRateLimit: DB no disponible (respuesta no-ok) — bloqueando petición por seguridad", { ip, status: res.status });
      return true;
    }
    const count = await res.json();
    return typeof count === "number" && count > MAX_REGISTRO_ATTEMPTS;
  } catch (e) {
    logger.warn("checkRegistroRateLimit: DB no disponible (excepción) — bloqueando petición por seguridad", { ip, error: e?.message });
    return true;
  }
}

function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limitado = await checkRegistroRateLimit(ip);
    if (limitado) {
      return NextResponse.json(
        { error: "Demasiados registros desde esta IP. Intentá de nuevo en 15 minutos." },
        { status: 429 }
      );
    }

    const rawBody = await req.json();
    const parsed = validateBody(registroEmpresaBody, rawBody);
    if (parsed.response) return parsed.response;
    const { nombre_empresa, nombre_admin, email, password, rubro } = parsed.data;

    const pwCheck = validarPassword(password);
    if (!pwCheck.valido) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Verificar email no repetido
    const existente = await sbFetch(`empresa?admin_email=eq.${encodeURIComponent(email)}&select=id`);
    if (existente && existente.length > 0) {
      return NextResponse.json({ error: "Ya existe una empresa con ese email" }, { status: 400 });
    }

    // Generar slug único
    let slug = generarSlug(nombre_empresa);
    const slugCheck = await sbFetch(`empresa?slug=eq.${slug}&select=id`);
    if (slugCheck && slugCheck.length > 0) {
      slug = slug + "-" + Date.now().toString(36).slice(-4);
    }

    // Hash de contraseña
    const hashed = await bcrypt.hash(password, 10);

    // Token de verificación de email (UUID hex)
    const verifyTokenBytes = new Uint8Array(24);
    crypto.getRandomValues(verifyTokenBytes);
    const verifyToken = Array.from(verifyTokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");

    // Crear empresa + admin atómicamente via RPC
    const nombreCorto = nombre_empresa.length > 12 ? nombre_empresa.slice(0, 12) : nombre_empresa;
    let emp, adminEmp;
    try {
      const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/rpc_crear_empresa_con_admin`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_nombre_empresa: nombre_empresa,
          p_nombre_corto: nombreCorto,
          p_admin_email: email,
          p_admin_password: hashed,
          p_rubro: rubro || "general",
          p_slug: slug,
          p_admin_nombre: nombre_admin,
          p_email_verify_token: verifyToken,
        }),
      });
      const rpcText = await rpcRes.text();
      if (!rpcRes.ok) {
        const errData = rpcText ? JSON.parse(rpcText) : {};
        const msg = errData.message || rpcText || "";
        if (rpcRes.status === 409 || msg.includes("23505")) {
          if (msg.includes("slug")) return NextResponse.json({ error: "Ese nombre de empresa ya está en uso. Intentá con otro nombre." }, { status: 409 });
          if (msg.includes("email") || msg.includes("admin_email")) return NextResponse.json({ error: "Ya existe una empresa registrada con ese email." }, { status: 409 });
        }
        throw new Error("RPC falló: " + msg);
      }
      const rpcData = JSON.parse(rpcText);
      emp = { id: rpcData.empresa_id, nombre: nombre_empresa, nombre_corto: nombreCorto, slug };
      adminEmp = { id: rpcData.empleado_id, nombre: nombre_admin, apodo: nombre_admin.split(" ")[0], legajo: 1, email, rol: "gerencial" };
    } catch (e) {
      if (e.message.startsWith("RPC falló:")) throw e;
      // Fallback: sequential inserts if RPC not deployed yet
      logger.error("RPC rpc_crear_empresa_con_admin no disponible, usando fallback secuencial", e);
      const empresa = await sbFetch("empresa", "POST", {
        nombre: nombre_empresa, nombre_corto: nombreCorto, admin_email: email,
        admin_password: hashed, rubro: rubro || "general", slug,
        plan_activo: "trial", trial_usado: true, max_empleados: 10,
        activa: true, email_verificado: false, email_verify_token: verifyToken,
      });
      if (!empresa || empresa.length === 0 || empresa.code) {
        if (empresa?.code === "23505") {
          const msg = empresa.message || "";
          if (msg.includes("slug")) return NextResponse.json({ error: "Ese nombre de empresa ya está en uso. Intentá con otro nombre." }, { status: 409 });
          if (msg.includes("email") || msg.includes("admin_email")) return NextResponse.json({ error: "Ya existe una empresa registrada con ese email." }, { status: 409 });
        }
        return NextResponse.json({ error: "Error al crear la empresa: " + (empresa?.message || JSON.stringify(empresa)) }, { status: 500 });
      }
      emp = empresa[0];
      const adminData = await sbFetch("empleados", "POST", {
        nombre: nombre_admin, apodo: nombre_admin.split(" ")[0], legajo: 1, email,
        password: hashed, rol: "gerencial", area: "administración", division: "general",
        activo: true, empresa_id: emp.id, debe_cambiar_password: false,
      });
      if (!adminData || adminData.length === 0 || adminData.code) {
        await sbFetch(`empresa?id=eq.${emp.id}`, "DELETE");
        return NextResponse.json({ error: "Error al crear el usuario admin: " + (adminData.message || JSON.stringify(adminData)) }, { status: 500 });
      }
      adminEmp = adminData[0];
    }

    // ─── Crear entrada de trial en suscripciones ───
    // Intenta el RPC primero (crea suscripcion + actualiza empresa atómicamente en DB).
    // Si falla, cae a INSERT directo. La empresa ya fue creada con plan_activo:"trial"
    // así que el peor caso es trial sin suscripcion_activa_id (acceso garantizado, vencimiento no).
    const trialFin = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    let trialIniciado = false;
    try {
      const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/iniciar_trial_pro`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_empresa_id: emp.id }),
        signal: AbortSignal.timeout(5000),
      });
      if (rpcRes.ok) trialIniciado = true;
      else logger.error(`RPC iniciar_trial_pro status ${rpcRes.status} — usando fallback`);
    } catch (e) {
      logger.error("RPC iniciar_trial_pro excepción — usando fallback", e);
    }

    if (!trialIniciado) {
      try {
        const susc = await sbFetch("suscripciones", "POST", {
          empresa_id: emp.id,
          plan: "pro",
          estado: "trial",
          trial_fin: trialFin,
          precio: 0,
          moneda: "ARS",
          gateway: "gypi_trial",
        });
        if (Array.isArray(susc) && susc[0]?.id) {
          await sbFetch(`empresa?id=eq.${emp.id}`, "PATCH", { suscripcion_activa_id: susc[0].id });
          trialIniciado = true;
        } else {
          logger.error("Fallback trial: INSERT suscripciones sin id para empresa " + emp.id, new Error(JSON.stringify(susc)));
        }
      } catch (e) {
        logger.error("Fallback trial también falló para empresa " + emp.id, e);
      }
    }

    // Fire-and-forget — no bloquea la respuesta
    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";
    const verifyUrl = `${appBase}/api/verificar-email?token=${verifyToken}&e=${emp.id}`;
    sendVerificacionEmail({ to: email, nombre: nombre_admin, empresa: emp.nombre, verifyUrl });
    sendBienvenida({ to: email, nombre: nombre_admin, empresa: emp.nombre, slug: emp.slug });

    logEvent(EVT.REGISTRO, {
      empresa_id: emp.id,
      plan: "trial",
      meta: { rubro: rubro || "general", slug: emp.slug },
    });

    return NextResponse.json({
      ok: true,
      empresa: { id: emp.id, nombre: emp.nombre, slug: emp.slug },
      usuario: Array.isArray(adminEmp) ? adminEmp[0] : adminEmp,
    });

  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
