// app/api/registro-empresa/route.js
// Registra una nueva empresa y su usuario admin
// FIX: sbFetch ahora verifica res.ok antes de parsear JSON
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sendBienvenida, sendVerificacionEmail } from "../../lib/email";
import { validarPassword } from "../../lib/validators";
import { logger } from "../../lib/logger";

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
    const { nombre_empresa, nombre_admin, email, password, rubro } = await req.json();

    // Validaciones
    if (!nombre_empresa || !nombre_admin || !email || !password) {
      return NextResponse.json({ error: "Completá todos los campos" }, { status: 400 });
    }
    if (
      typeof nombre_empresa !== "string" || nombre_empresa.length > 100 ||
      typeof nombre_admin !== "string" || nombre_admin.length > 100 ||
      typeof email !== "string" || email.length > 254
    ) {
      return NextResponse.json({ error: "Los datos ingresados son demasiado largos" }, { status: 400 });
    }
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

    // Crear empresa (email_verificado: false hasta confirmar el link)
    const empresa = await sbFetch("empresa", "POST", {
      nombre: nombre_empresa,
      nombre_corto: nombre_empresa.length > 12 ? nombre_empresa.slice(0, 12) : nombre_empresa,
      admin_email: email,
      admin_password: hashed,
      rubro: rubro || "general",
      slug,
      plan_activo: "trial",
      trial_usado: true,
      max_empleados: 10,
      activa: true,
      email_verificado: false,
      email_verify_token: verifyToken,
    });

    if (!empresa || empresa.length === 0 || empresa.code) {
      if (empresa?.code === "23505") {
        const msg = empresa.message || "";
        if (msg.includes("slug")) {
          return NextResponse.json({ error: "Ese nombre de empresa ya está en uso. Intentá con otro nombre." }, { status: 409 });
        }
        if (msg.includes("email") || msg.includes("admin_email")) {
          return NextResponse.json({ error: "Ya existe una empresa registrada con ese email." }, { status: 409 });
        }
      }
      return NextResponse.json({ error: "Error al crear la empresa: " + (empresa?.message || JSON.stringify(empresa)) }, { status: 500 });
    }

    const emp = empresa[0];

    // Crear empleado admin
    const adminEmp = await sbFetch("empleados", "POST", {
      nombre: nombre_admin,
      apodo: nombre_admin.split(" ")[0],
      legajo: 1,
      email,
      password: hashed,
      rol: "gerencial",
      area: "administración",
      division: "general",
      activo: true,
      empresa_id: emp.id,
      debe_cambiar_password: false,
    });

    if (!adminEmp || adminEmp.length === 0 || adminEmp.code) {
      // Si falla el empleado, borrar la empresa creada
      await sbFetch(`empresa?id=eq.${emp.id}`, "DELETE");
      return NextResponse.json({ error: "Error al crear el usuario admin: " + (adminEmp.message || JSON.stringify(adminEmp)) }, { status: 500 });
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

    return NextResponse.json({
      ok: true,
      empresa: { id: emp.id, nombre: emp.nombre, slug: emp.slug },
      usuario: adminEmp[0],
    });

  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
