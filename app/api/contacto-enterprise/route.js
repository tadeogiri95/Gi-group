// app/api/contacto-enterprise/route.js
// Endpoint público (sin auth) para el formulario de "Contactanos" del plan
// Enterprise — landing, /pricing y BillingScreen. Reemplaza el mailto: por
// un flujo self-service que notifica al equipo de Gypi por email.
import { NextResponse } from "next/server";
import { sendConsultaEnterprise } from "../../lib/email";
import { ventana15min } from "../../lib/rateLimit";
import { contactoEnterpriseBody } from "../../lib/schemas";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { logEvent, EVT } from "../../lib/analytics";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Rate limit: máximo 3 consultas por IP por ventana de 15 minutos.
// Reutiliza rpc_login_attempt con prefijo "contacto:" (mismo patrón que
// registro-empresa con "reg:"). Fail-closed si la DB no responde.
const MAX_CONTACTO_ATTEMPTS = 3;
async function checkContactoRateLimit(ip) {
  if (!SB_URL || !SB_KEY || !ip) return false;
  try {
    const ventana = ventana15min();
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: `contacto:${ip}`, p_ventana: ventana }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn("checkContactoRateLimit: DB no disponible (respuesta no-ok) — bloqueando por seguridad", { ip, status: res.status });
      return true;
    }
    const count = await res.json();
    return typeof count === "number" && count > MAX_CONTACTO_ATTEMPTS;
  } catch (e) {
    logger.warn("checkContactoRateLimit: DB no disponible (excepción) — bloqueando por seguridad", { ip, error: e?.message });
    return true;
  }
}

export async function POST(req) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const limitado = await checkContactoRateLimit(ip);
    if (limitado) {
      return NextResponse.json(
        { error: "Demasiadas consultas desde esta IP. Intentá de nuevo en 15 minutos." },
        { status: 429 }
      );
    }

    const rawBody = await req.json();
    const parsed = validateBody(contactoEnterpriseBody, rawBody);
    if (parsed.response) return parsed.response;
    const { nombre, email, empresa, telefono, mensaje } = parsed.data;

    await sendConsultaEnterprise({ nombre, email, empresa, telefono, mensaje });
    logEvent(EVT.CONSULTA_ENTERPRISE, { meta: { empresa, email } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
