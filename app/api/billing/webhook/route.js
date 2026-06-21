// ═══════════════════════════════════════════════════════════
// POST /api/billing/webhook
// Recibe notificaciones de MP: pago aprobado, suscripción cancelada, etc.
//
// ENTREGA 1D: Firma HMAC OBLIGATORIA. Si MERCADOPAGO_WEBHOOK_SECRET
// no está configurada, el endpoint retorna 500 en lugar de bypasear.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getPreapproval, getPago, cancelarPreapproval } from "../../../lib/mercadopago";
import { sendFalloPago, sendPlanSuspendido, sendPagoConfirmado } from "../../../lib/email";
import { logger } from "../../../lib/logger";
import { sbGet, sbPost, sbPatchOk } from "../../../lib/sbHelpers";
import { logEvent, EVT } from "../../../lib/analytics";

const WH_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;

// ═══════════════════════════════════════════════════════════
// CAMBIO 1D: Firma OBLIGATORIA
// Antes: if (!WH_SECRET) return true  ← PELIGROSO
// Ahora: si no hay secret, el POST entero retorna 500 antes
//        de llegar a validarFirma. La función SIEMPRE valida.
// ═══════════════════════════════════════════════════════════
function validarFirma(request) {
  const signature = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  if (!signature || !requestId) return false;

  const parts = Object.fromEntries(signature.split(",").map(p => p.trim().split("=")));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") || "";

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac("sha256", WH_SECRET).update(manifest).digest("hex");

  // Comparación constant-time para prevenir timing attacks
  try {
    const hashBuf = Buffer.from(hash, "hex");
    const v1Buf   = Buffer.from(v1,   "hex");
    if (hashBuf.length !== v1Buf.length) return false;
    return crypto.timingSafeEqual(hashBuf, v1Buf);
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    // ═══ CAMBIO 1D: Bloquear si no hay secret configurado ═══
    if (!WH_SECRET) {
      logger.error("MERCADOPAGO_WEBHOOK_SECRET no configurada — rechazando request");
      return NextResponse.json(
        { ok: false, error: "Webhook no configurado (falta MERCADOPAGO_WEBHOOK_SECRET)" },
        { status: 500 }
      );
    }

    const rawBody = await request.text();
    let body;
    try { body = JSON.parse(rawBody); } catch { body = {}; }

    // ═══ CAMBIO 1D: Validación SIEMPRE activa ═══
    if (!validarFirma(request)) {
      logger.warn("Firma HMAC inválida — posible ataque", {
        signature: request.headers.get("x-signature")?.slice(0, 30) + "...",
        requestId: request.headers.get("x-request-id"),
        ip: request.headers.get("x-forwarded-for"),
      });
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    // ═══ Freshness check: previene replay attacks ═══
    // ts viene en el header x-signature como "ts=<unix_ms>,v1=<hash>"
    const sigHeader = request.headers.get("x-signature") || "";
    const sigParts = Object.fromEntries(sigHeader.split(",").map(p => p.trim().split("=")));
    const tsRaw = sigParts.ts;
    if (tsRaw) {
      const tsMs = Number(tsRaw);
      const nowMs = Date.now();
      const diffMs = nowMs - tsMs;
      // Más de 5 minutos en el pasado → posible replay
      if (diffMs > 5 * 60 * 1000) {
        logger.warn("Webhook replay detectado: timestamp demasiado antiguo", {
          ts: tsRaw,
          diffSeconds: Math.floor(diffMs / 1000),
          ip: request.headers.get("x-forwarded-for"),
        });
        return NextResponse.json(
          { ok: false, error: "Webhook replay detected: timestamp too old" },
          { status: 403 }
        );
      }
      // Más de 30 segundos en el futuro → timestamp manipulado
      if (diffMs < -30 * 1000) {
        logger.warn("Webhook rechazado: timestamp en el futuro", {
          ts: tsRaw,
          diffSeconds: Math.floor(diffMs / 1000),
          ip: request.headers.get("x-forwarded-for"),
        });
        return NextResponse.json(
          { ok: false, error: "Webhook replay detected: timestamp in the future" },
          { status: 403 }
        );
      }
    }

    const tipo = body.type || body.topic;
    const dataId = body.data?.id || body.id;
    logger.debug("[webhook] Recibido:", tipo, dataId);

    // ─── Suscripción (preapproval) ───
    if (tipo === "subscription_preapproval" || tipo === "preapproval") {
      const preapproval = await getPreapproval(dataId);
      const externalRef = preapproval.external_reference || "";
      const match = externalRef.match(/^gypi-([0-9a-f-]+)-([0-9a-f-]+)$/i);
      if (!match) {
        logger.warn("external_reference inválido", { externalRef });
        return NextResponse.json({ ok: true });
      }
      const empresaId = match[1];
      const suscId = match[2];

      let nuevoEstado = "suspendida";
      if (preapproval.status === "authorized") nuevoEstado = "activa";
      else if (preapproval.status === "paused") nuevoEstado = "suspendida";
      else if (preapproval.status === "cancelled") nuevoEstado = "cancelada";
      else if (preapproval.status === "pending") nuevoEstado = "suspendida";

      // ═══ P4: Idempotencia — si el estado local ya coincide, skip ═══
      const [suscActual] = await sbGet(`suscripciones?id=eq.${suscId}&select=estado,plan&limit=1`, { silent: true, fallback: [] });
      if (suscActual?.estado === nuevoEstado) {
        logger.debug("[webhook] Preapproval ya procesado, mismo estado", { suscId, estado: nuevoEstado });
        return NextResponse.json({ ok: true, accion: `susc_${nuevoEstado}_ya_procesado` });
      }

      await sbPatchOk(`suscripciones?id=eq.${suscId}`, {
        estado: nuevoEstado,
        gateway_customer_id: preapproval.payer_id?.toString() || null,
        periodo_inicio: preapproval.date_created || null,
        periodo_fin: preapproval.next_payment_date || null,
      });

      if (nuevoEstado === "activa") {
        const plan = suscActual?.plan || "free";

        // ═══ P1: Cancelar suscripciones concurrentes en MP (no solo local) ═══
        const otras = await sbGet(
          `suscripciones?empresa_id=eq.${empresaId}&estado=in.(trial,activa)&id=neq.${suscId}&select=id,gateway_subscription_id`,
          { silent: true, fallback: [] }
        );
        for (const otra of otras) {
          if (otra.gateway_subscription_id) {
            try {
              await cancelarPreapproval(otra.gateway_subscription_id);
              logger.debug("[webhook] Preapproval concurrente cancelado en MP", { id: otra.gateway_subscription_id });
            } catch (e) {
              logger.error("[webhook] Error cancelando preapproval concurrente", e, { id: otra.gateway_subscription_id });
            }
          }
        }
        await sbPatchOk(
          `suscripciones?empresa_id=eq.${empresaId}&estado=in.(trial,activa)&id=neq.${suscId}`,
          { estado: "cancelada" }
        );

        // ═══ P3: Respetar override manual del superadmin ═══
        const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=plan_override_manual&limit=1`, { silent: true, fallback: [] });
        if (emp?.plan_override_manual) {
          logger.warn("[webhook] plan_override_manual activo, no se cambia plan_activo", { empresaId, plan });
        } else {
          await sbPatchOk(`empresa?id=eq.${empresaId}`, {
            plan_activo: plan,
            suscripcion_activa_id: suscId,
            plan_vence: null,
          });
        }
      } else if (nuevoEstado === "suspendida" || nuevoEstado === "cancelada") {
        // ═══ P2: Grace period — mantener plan hasta periodo_fin ═══
        // ═══ P3: Respetar override manual ═══
        const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=plan_override_manual,admin_email,nombre_corto,nombre,slug&limit=1`, { silent: true, fallback: [] });

        if (!emp?.plan_override_manual) {
          const periodoFin = preapproval.next_payment_date;
          if (periodoFin && new Date(periodoFin) > new Date()) {
            // Grace period: mantener plan activo hasta fin del período pago
            await sbPatchOk(`empresa?id=eq.${empresaId}`, {
              plan_vence: periodoFin,
              suscripcion_activa_id: null,
            });
            logger.debug("[webhook] Grace period activado", { empresaId, plan_vence: periodoFin });
          } else {
            await sbPatchOk(`empresa?id=eq.${empresaId}`, {
              plan_activo: "free",
              suscripcion_activa_id: null,
              plan_vence: null,
            });
          }
        }

        // Notificar al admin (fire-and-forget)
        try {
          if (emp?.admin_email) {
            sendPlanSuspendido({
              to: emp.admin_email,
              nombre: emp.nombre_corto || emp.nombre,
              empresa: emp.nombre_corto || emp.nombre,
              slug: emp.slug,
              motivo: nuevoEstado === "suspendida" ? "impago" : "cancelación",
              empresaId,
            });
          }
        } catch (e) {
          logger.error("Error enviando email de suspensión", e);
        }
      }

      if (nuevoEstado === "activa") {
        logEvent(EVT.UPGRADE_COMPLETE, { empresa_id: empresaId, plan: suscActual?.plan, meta: { gateway: "mercadopago" } });
      } else if (nuevoEstado === "cancelada" || nuevoEstado === "suspendida") {
        logEvent(EVT.CHURN, { empresa_id: empresaId, meta: { motivo: nuevoEstado, gateway: "mercadopago" } });
      }

      return NextResponse.json({ ok: true, accion: `susc_${nuevoEstado}` });
    }

    // ─── Pago ───
    if (tipo === "payment" || tipo === "subscription_authorized_payment") {
      const pago = await getPago(dataId);
      const externalRef = pago.external_reference || "";
      const match = externalRef.match(/^gypi-([0-9a-f-]+)-([0-9a-f-]+)$/i);
      const empresaId = match?.[1];
      const suscId = match?.[2];

      // Idempotencia: MP reintenta webhooks — no insertar si ya existe este pago.
      // Si el pago existe pero empresa.plan_activo no fue actualizado (ej: el PATCH
      // falló en el intento anterior), repararlo antes de retornar.
      if (pago.id) {
        const existing = await sbGet(`pagos?gateway_payment_id=eq.${pago.id}&select=id&limit=1`);
        if (Array.isArray(existing) && existing.length > 0) {
          if (pago.status === "approved" && suscId && empresaId) {
            try {
              const [susc] = await sbGet(`suscripciones?id=eq.${suscId}&select=plan&limit=1`);
              const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=plan_activo,plan_override_manual&limit=1`);
              if (susc?.plan && emp?.plan_activo !== susc.plan && !emp?.plan_override_manual) {
                logger.warn("[webhook] Reparando plan_activo tras retry", { empresaId, suscId, plan: susc.plan });
                await sbPatchOk(`empresa?id=eq.${empresaId}`, {
                  plan_activo: susc.plan,
                  suscripcion_activa_id: suscId,
                });
              }
            } catch (e) {
              logger.error("[webhook] Error en reparación de plan_activo", e, { empresaId, suscId });
            }
          }
          logger.debug("[webhook] Pago ya procesado, ignorando reintento:", pago.id);
          return NextResponse.json({ ok: true, accion: "pago_ya_procesado" });
        }
      }

      let estadoPago = "pendiente";
      if (pago.status === "approved") estadoPago = "aprobado";
      else if (pago.status === "rejected") estadoPago = "rechazado";
      else if (pago.status === "refunded") estadoPago = "reembolsado";

      await sbPost("pagos", {
        empresa_id: empresaId || null,
        suscripcion_id: suscId || null,
        monto: pago.transaction_amount,
        moneda: pago.currency_id || "ARS",
        estado: estadoPago,
        gateway: "mercadopago",
        gateway_payment_id: pago.id?.toString(),
        fecha_pago: pago.date_approved || pago.date_created,
      });

      if (estadoPago === "aprobado" && suscId) {
        await sbPatchOk(`suscripciones?id=eq.${suscId}`, { estado: "activa" });
        if (empresaId) {
          const susc = await sbGet(`suscripciones?id=eq.${suscId}&select=plan`);
          // P3: Respetar override manual
          const [empCheck] = await sbGet(`empresa?id=eq.${empresaId}&select=plan_override_manual&limit=1`, { silent: true, fallback: [] });
          if (susc?.[0]?.plan && !empCheck?.plan_override_manual) {
            await sbPatchOk(`empresa?id=eq.${empresaId}`, {
              plan_activo: susc[0].plan,
              suscripcion_activa_id: suscId,
              plan_vence: null,
            });
          }
          try {
            const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=admin_email,nombre_corto,nombre,slug`);
            if (emp?.admin_email) {
              sendPagoConfirmado({
                to: emp.admin_email,
                nombre: emp.nombre_corto || emp.nombre,
                empresa: emp.nombre_corto || emp.nombre,
                slug: emp.slug,
                monto: pago.transaction_amount,
                plan: susc?.[0]?.plan || "Pro",
                empresaId,
              });
            }
          } catch (e) { logger.error("Error enviando email pago confirmado", e); }
        }
      }

      if (estadoPago === "rechazado" && empresaId) {
        try {
          const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=admin_email,nombre_corto,nombre,slug`);
          if (emp?.admin_email) {
            sendFalloPago({
              to: emp.admin_email,
              nombre: emp.nombre_corto || emp.nombre,
              empresa: emp.nombre_corto || emp.nombre,
              slug: emp.slug,
              monto: pago.transaction_amount,
              empresaId,
            });
          }
        } catch (e) {
          logger.error("Error enviando email fallo pago", e);
        }
      }

      if (estadoPago === "aprobado") {
        logEvent(EVT.PAGO_APROBADO, { empresa_id: empresaId, meta: { monto: pago.transaction_amount, moneda: pago.currency_id } });
      } else if (estadoPago === "rechazado") {
        logEvent(EVT.PAGO_RECHAZADO, { empresa_id: empresaId, meta: { monto: pago.transaction_amount, moneda: pago.currency_id } });
      }

      return NextResponse.json({ ok: true, accion: `pago_${estadoPago}` });
    }

    return NextResponse.json({ ok: true, ignorado: tipo });
  } catch (err) {
    if (err.status === 404 || /not found/i.test(err.message)) {
      logger.debug("Recurso no encontrado (simulación o ID viejo):", err.message);
      return NextResponse.json({ ok: true, ignorado: "not_found" });
    }
    logger.error("webhook error", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "gypi-billing-webhook" });
}
