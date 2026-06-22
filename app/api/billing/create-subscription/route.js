// ═══════════════════════════════════════════════════════════
// POST /api/billing/create-subscription
// Body: { plan: "starter" | "pro" }
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { crearPreapproval, getPreapproval } from "../../../lib/mercadopago";
import { PLANES, precioAnual } from "../../../lib/plans";
import { sbGet, sbPost, sbPatchOk } from "../../../lib/sbHelpers";
import { logEvent, EVT } from "../../../lib/analytics";
import { logger } from "../../../lib/logger";
import { safeErrorMessage } from "../../../lib/validate";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Solo el administrador puede cambiar el plan" }, { status: 403 });
    }

    const { plan, periodo = "mensual" } = await request.json();
    if (!plan || !["starter", "pro"].includes(plan)) {
      return NextResponse.json({ error: "Plan inválido. Usá 'starter' o 'pro'." }, { status: 400 });
    }
    if (!["mensual", "anual"].includes(periodo)) {
      return NextResponse.json({ error: "Periodo inválido. Usá 'mensual' o 'anual'." }, { status: 400 });
    }

    const planInfo = PLANES[plan];
    if (!planInfo?.precio) return NextResponse.json({ error: "Plan sin precio configurado" }, { status: 400 });

    const precioMensual = periodo === "anual" ? precioAnual(plan) : planInfo.precio;

    // ═══ P6: Dedup — reusar suscripción pendiente reciente (< 5 min) ═══
    const recientes = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&plan=eq.${plan}&periodo=eq.${periodo}&estado=eq.suspendida&gateway_subscription_id=not.is.null&order=created_at.desc&limit=1&select=id,gateway_subscription_id,created_at`,
      { silent: true, fallback: [] }
    );
    if (recientes?.[0]) {
      const creada = new Date(recientes[0].created_at);
      const ahoraMs = Date.now();
      if (ahoraMs - creada.getTime() < 5 * 60 * 1000) {
        try {
          const mp = await getPreapproval(recientes[0].gateway_subscription_id);
          if (mp.init_point && mp.status === "pending") {
            return NextResponse.json({
              ok: true,
              init_point: mp.init_point,
              suscripcion_id: recientes[0].id,
              mp_preapproval_id: recientes[0].gateway_subscription_id,
              dedup: true,
            });
          }
        } catch {}
      }
    }

    const emp = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=admin_email,nombre,slug`);
    if (!emp?.[0]) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    const empresa = emp[0];
    const payerEmail = empresa.admin_email;
    if (!payerEmail) return NextResponse.json({ error: "La empresa no tiene email de admin configurado" }, { status: 400 });

    const localSusc = await sbPost("suscripciones", {
      empresa_id: sesion.empresa_id,
      plan,
      estado: "suspendida",
      precio: precioMensual,
      moneda: "ARS",
      gateway: "mercadopago",
      periodo,
    });
    const suscId = localSusc[0].id;

    const externalRef = `gypi-${sesion.empresa_id}-${suscId}`;
    const backUrl = `${APP_URL}/${empresa.slug || ""}?billing=ok`;

    let mp;
    try {
      mp = await crearPreapproval({
        payerEmail,
        monto: precioMensual,
        plan: planInfo.nombre,
        empresaId: sesion.empresa_id,
        externalReference: externalRef,
        backUrl,
        periodo,
      });
    } catch (err) {
      logger.error("[create-subscription] Error MP", err, { body: err.body });
      return NextResponse.json({ error: "Error de Mercado Pago. Intentá de nuevo en unos minutos." }, { status: 500 });
    }

    await sbPatchOk(`suscripciones?id=eq.${suscId}`, { gateway_subscription_id: mp.id });

    // Limpiar override manual: el usuario está eligiendo plan vía MP
    await sbPatchOk(`empresa?id=eq.${sesion.empresa_id}`, {
      plan_override_manual: false,
    });

    logEvent(EVT.UPGRADE_INIT, {
      empresa_id: sesion.empresa_id,
      plan,
      meta: { periodo, precio: precioMensual },
    });

    return NextResponse.json({
      ok: true,
      init_point: mp.init_point,
      suscripcion_id: suscId,
      mp_preapproval_id: mp.id,
    });
  } catch (err) {
    logger.error("[create-subscription] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
