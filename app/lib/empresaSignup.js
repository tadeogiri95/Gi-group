// app/lib/empresaSignup.js — Creación atómica de empresa + admin
//
// Extraído de registro-empresa/route.js para reusar el mismo camino (RPC
// rpc_crear_empresa_con_admin + fallback secuencial con rollback manual)
// desde el signup vía Google (intent=registro en /api/auth/google/callback).
//
// admin_password puede ser null (signup vía Google, sin password propia).

import { logger } from "./logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function sbFetch(path, method = "GET", body = null) {
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

// .code permite que cada caller decida cómo responder (409 JSON en
// registro-empresa, redirect ?oauth_error= en el callback de Google).
export class EmpresaSignupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function generarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

// Genera un slug y, si ya existe, le agrega un sufijo random — usado tanto
// por el registro con password como por el signup vía Google.
export async function generarSlugUnico(nombre) {
  let slug = generarSlug(nombre);
  const slugCheck = await sbFetch(`empresa?slug=eq.${slug}&select=id`);
  if (slugCheck && slugCheck.length > 0) {
    slug = slug + "-" + Date.now().toString(36).slice(-4);
  }
  return slug;
}

export async function crearEmpresaConAdmin({
  nombreEmpresa, nombreCorto, adminEmail, adminPassword, rubro, slug, adminNombre, emailVerifyToken,
}) {
  let emp, adminEmp;
  try {
    const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/rpc_crear_empresa_con_admin`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_nombre_empresa: nombreEmpresa,
        p_nombre_corto: nombreCorto,
        p_admin_email: adminEmail,
        p_admin_password: adminPassword,
        p_rubro: rubro || "general",
        p_slug: slug,
        p_admin_nombre: adminNombre,
        p_email_verify_token: emailVerifyToken,
      }),
    });
    const rpcText = await rpcRes.text();
    if (!rpcRes.ok) {
      const errData = rpcText ? JSON.parse(rpcText) : {};
      const msg = errData.message || rpcText || "";
      if (rpcRes.status === 409 || msg.includes("23505")) {
        if (msg.includes("slug")) throw new EmpresaSignupError("SLUG_TAKEN", "Ese nombre de empresa ya está en uso. Intentá con otro nombre.");
        if (msg.includes("email") || msg.includes("admin_email")) throw new EmpresaSignupError("EMAIL_TAKEN", "Ya existe una empresa registrada con ese email.");
      }
      throw new Error("RPC falló: " + msg);
    }
    const rpcData = JSON.parse(rpcText);
    emp = { id: rpcData.empresa_id, nombre: nombreEmpresa, nombre_corto: nombreCorto, slug };
    adminEmp = { id: rpcData.empleado_id, nombre: adminNombre, apodo: adminNombre.split(" ")[0], legajo: 1, email: adminEmail, rol: "gerencial" };
  } catch (e) {
    if (e instanceof EmpresaSignupError) throw e;
    if (e.message?.startsWith("RPC falló:")) throw e;
    // Fallback: inserts secuenciales si la RPC no está desplegada todavía
    logger.error("RPC rpc_crear_empresa_con_admin no disponible, usando fallback secuencial", e);
    const empresa = await sbFetch("empresa", "POST", {
      nombre: nombreEmpresa, nombre_corto: nombreCorto, admin_email: adminEmail,
      admin_password: adminPassword, rubro: rubro || "general", slug,
      plan_activo: "trial", trial_usado: true, max_empleados: 10,
      activa: true, email_verificado: false, email_verify_token: emailVerifyToken,
    });
    if (!empresa || empresa.length === 0 || empresa.code) {
      if (empresa?.code === "23505") {
        const msg = empresa.message || "";
        if (msg.includes("slug")) throw new EmpresaSignupError("SLUG_TAKEN", "Ese nombre de empresa ya está en uso. Intentá con otro nombre.");
        if (msg.includes("email") || msg.includes("admin_email")) throw new EmpresaSignupError("EMAIL_TAKEN", "Ya existe una empresa registrada con ese email.");
      }
      throw new Error("Error al crear la empresa: " + (empresa?.message || JSON.stringify(empresa)));
    }
    emp = empresa[0];
    const adminData = await sbFetch("empleados", "POST", {
      nombre: adminNombre, apodo: adminNombre.split(" ")[0], legajo: 1, email: adminEmail,
      password: adminPassword, rol: "gerencial", area: "administración", division: "general",
      activo: true, empresa_id: emp.id, debe_cambiar_password: false,
    });
    if (!adminData || adminData.length === 0 || adminData.code) {
      await sbFetch(`empresa?id=eq.${emp.id}`, "DELETE");
      throw new Error("Error al crear el usuario admin: " + (adminData.message || JSON.stringify(adminData)));
    }
    adminEmp = adminData[0];
  }

  return { emp, adminEmp };
}

// Inicia el trial de 14 días para una empresa recién creada. Intenta la RPC
// atómica primero (crea la suscripción y actualiza empresa.suscripcion_activa_id
// en un solo paso); si falla, cae a un INSERT directo + PATCH de vuelta.
// La empresa ya fue creada con plan_activo:"trial", así que el peor caso de
// una doble falla es trial sin suscripcion_activa_id (acceso garantizado,
// vencimiento no — billing/info la trata como vencida vía created_at hasta
// que se resuelva a mano o vía el cron de huérfanas).
export async function iniciarTrialEmpresa(empresaId) {
  let trialIniciado = false;
  try {
    const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/iniciar_trial_pro`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_empresa_id: empresaId }),
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
        empresa_id: empresaId,
        plan: "pro",
        estado: "trial",
        trial_fin: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        precio: 0,
        moneda: "ARS",
        gateway: "gypi_trial",
      });
      if (Array.isArray(susc) && susc[0]?.id) {
        await sbFetch(`empresa?id=eq.${empresaId}`, "PATCH", { suscripcion_activa_id: susc[0].id });
        trialIniciado = true;
      } else {
        logger.error("Fallback trial: INSERT suscripciones sin id para empresa " + empresaId, new Error(JSON.stringify(susc)));
      }
    } catch (e) {
      logger.error("Fallback trial también falló para empresa " + empresaId, e);
    }
  }

  if (!trialIniciado) {
    logger.error(
      "[TRIAL_DOBLE_FALLA] RPC iniciar_trial_pro y el INSERT de fallback a suscripciones fallaron los dos — la empresa queda con plan_activo=trial sin ninguna fila en suscripciones (billing/info la trata como vencida vía created_at, pero requiere intervención manual o esperar al cron de huérfanas)",
      new Error(`empresa_id=${empresaId}`),
      { empresa_id: empresaId }
    );
  }

  return trialIniciado;
}
