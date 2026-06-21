// ═══════════════════════════════════════════════════════════
// POST /api/billing/portal — Cancelar suscripción activa
// GET  /api/billing/portal — Link al historial de MP
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { cancelarPreapproval } from "../../../lib/mercadopago";
import { sbGet, sbPatchOk } from "../../../lib/sbHelpers";
import { invalidarCachePlan } from "../../../lib/planEnforcement";
import { logger } from "../../../lib/logger";

export async function GET(request) {
  return NextResponse.json({
    portal_url: "https://www.mercadopago.com.ar/subscriptions",
    descripcion: "Gestioná tu suscripción y métodos de pago en Mercado Pago",
  });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Sin permisos para cancelar suscripción" }, { status: 403 });
    }

    const subs = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&estado=eq.activa&gateway=eq.mercadopago&order=created_at.desc&limit=1&select=id,gateway_subscription_id,periodo_fin`
    );
    const sub = subs?.[0];
    if (!sub) return NextResponse.json({ error: "No tenés una suscripción activa en Mercado Pago" }, { status: 404 });
    if (!sub.gateway_subscription_id) return NextResponse.json({ error: "Suscripción sin ID de MP" }, { status: 400 });

    await cancelarPreapproval(sub.gateway_subscription_id);

    // ═══ P5: Actualizar estado local inmediatamente (no esperar webhook) ═══
    await sbPatchOk(`suscripciones?id=eq.${sub.id}`, { estado: "cancelada" });

    // Grace period: mantener plan hasta periodo_fin si existe y es futuro
    const periodoFin = sub.periodo_fin;
    if (periodoFin && new Date(periodoFin) > new Date()) {
      await sbPatchOk(`empresa?id=eq.${sesion.empresa_id}`, {
        plan_vence: periodoFin,
        suscripcion_activa_id: null,
      });
    } else {
      await sbPatchOk(`empresa?id=eq.${sesion.empresa_id}`, {
        plan_activo: "free",
        suscripcion_activa_id: null,
        plan_vence: null,
      });
    }

    invalidarCachePlan(sesion.empresa_id);

    const graceMsg = periodoFin && new Date(periodoFin) > new Date()
      ? `Seguirás en tu plan actual hasta ${new Date(periodoFin).toLocaleDateString("es-AR")}. Después pasarás al plan Free.`
      : "Tu plan fue cambiado a Free.";

    return NextResponse.json({ ok: true, mensaje: `Suscripción cancelada. ${graceMsg}` });
  } catch (err) {
    logger.error("[billing/portal] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
