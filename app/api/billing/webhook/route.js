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
import { emitirFacturaC } from "../../../lib/afip";
import { logger } from "../../../lib/logger";
import { sbGet, sbPost, sbPatch, sbPatchOk, sbRpc } from "../../../lib/sbHelpers";
import { logEvent, EVT } from "../../../lib/analytics";
import { safeErrorMessage } from "../../../lib/validate";

import { ipCliente } from "../../../lib/ip";
import { verificarSuscripcion, montoCoincide, leerReferencia } from "../../../lib/validarCobro";
const WH_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;
// Lo que hace falta de la suscripción para validar el aviso (ítem 25)
const SUSC_CAMPOS = "plan,estado,empresa_id,gateway_subscription_id,precio,precio_nuevo,periodo,addons";
// Sin la migración 082 no existen precio_nuevo ni addons: se lee lo de antes
// para no dejar de activar planes por una columna que falta.
const SUSC_CAMPOS_PREVIOS = "plan,estado,empresa_id,gateway_subscription_id,precio,periodo";
async function leerSuscripcion(suscId) {
  try {
    return (await sbGet(`suscripciones?id=eq.${suscId}&select=${SUSC_CAMPOS}&limit=1`))?.[0] ?? null;
  } catch {
    return (await sbGet(`suscripciones?id=eq.${suscId}&select=${SUSC_CAMPOS_PREVIOS}&limit=1`, { silent: true, fallback: [] }))?.[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════
// CAMBIO 1D: Firma OBLIGATORIA
// Antes: if (!WH_SECRET) return true  ← PELIGROSO
// Ahora: si no hay secret, el POST entero retorna 500 antes
//        de llegar a validarFirma. La función SIEMPRE valida.
// ═══════════════════════════════════════════════════════════
// F1-08: cambios de estado de un pago ya registrado que sí se procesan.
// Cualquier otro (mismo estado = reintento, o un estado viejo que llega tarde) se ignora.
const TRANSICIONES_PAGO = {
  pendiente: new Set(["aprobado", "rechazado"]),
  aprobado: new Set(["reembolsado"]),
};
function transicionPagoValida(de, a) {
  return TRANSICIONES_PAGO[de]?.has(a) || false;
}

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
        ip: ipCliente(request),
      });
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    // ═══ Freshness check: previene replay attacks ═══
    // ts viene en el header x-signature como "ts=<unix>,v1=<hash>"
    const sigHeader = request.headers.get("x-signature") || "";
    const sigParts = Object.fromEntries(sigHeader.split(",").map(p => p.trim().split("=")));
    const tsRaw = sigParts.ts;
    if (tsRaw) {
      // F1-09: los ejemplos de Mercado Pago muestran el ts en segundos (10
      // dígitos); se aceptan segundos y milisegundos. Un ts no numérico se rechaza.
      const tsNum = Number(tsRaw);
      if (!Number.isFinite(tsNum)) {
        return NextResponse.json({ ok: false, error: "Webhook rechazado: timestamp inválido" }, { status: 403 });
      }
      const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
      const nowMs = Date.now();
      const diffMs = nowMs - tsMs;
      // Más de 5 minutos en el pasado → posible replay
      if (diffMs > 5 * 60 * 1000) {
        logger.warn("Webhook replay detectado: timestamp demasiado antiguo", {
          ts: tsRaw,
          diffSeconds: Math.floor(diffMs / 1000),
          ip: ipCliente(request),
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
          ip: ipCliente(request),
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
      const ref = leerReferencia(externalRef);
      if (!ref) {
        logger.warn("external_reference inválido", { externalRef });
        return NextResponse.json({ ok: true });
      }
      const { empresaId, suscId } = ref;

      let nuevoEstado = "suspendida";
      if (preapproval.status === "authorized") nuevoEstado = "activa";
      else if (preapproval.status === "paused") nuevoEstado = "suspendida";
      else if (preapproval.status === "cancelled") nuevoEstado = "cancelada";
      else if (preapproval.status === "pending") nuevoEstado = "suspendida";

      const suscActual = await leerSuscripcion(suscId);

      // F2-11: la suscripción tiene que ser de esa empresa y de ese preapproval
      const control = verificarSuscripcion(suscActual, { empresaId, preapprovalId: preapproval.id });
      if (!control.ok) {
        logger.warn("[webhook] Preapproval que no corresponde a la suscripción", { suscId, empresaId, motivo: control.motivo });
        return NextResponse.json({ ok: true, ignorado: control.motivo });
      }
      // Y el monto autorizado, el acordado: si no, no se activa el plan
      const montoAutorizado = preapproval.auto_recurring?.transaction_amount;
      if (nuevoEstado === "activa" && montoAutorizado != null && !montoCoincide(suscActual, montoAutorizado)) {
        logger.error("[webhook] Monto del preapproval distinto del acordado", new Error("monto_no_coincide"), { suscId, empresaId, montoAutorizado });
        return NextResponse.json({ ok: true, accion: "monto_no_coincide" });
      }

      // ═══ P4: Idempotencia — si el estado local ya coincide, skip ═══
      if (suscActual?.estado === nuevoEstado) {
        logger.debug("[webhook] Preapproval ya procesado, mismo estado", { suscId, estado: nuevoEstado });
        return NextResponse.json({ ok: true, accion: `susc_${nuevoEstado}_ya_procesado` });
      }

      // Suscripción, otras suscripciones y plan de la empresa van juntos en
      // una transacción (aplicar_suscripcion, migración 088; ítem 38).
      const aplicado = await sbRpc("aplicar_suscripcion", {
        p_empresa: empresaId,
        p_susc: suscId,
        p_estado: nuevoEstado,
        p_datos: {
          gateway_customer_id: preapproval.payer_id?.toString() || null,
          periodo_inicio: preapproval.date_created || null,
          periodo_fin: preapproval.next_payment_date || null,
        },
        p_cancelar_otras: nuevoEstado === "activa",
        p_plan_vence: nuevoEstado === "activa" ? null : preapproval.next_payment_date || null,
      });
      if (aplicado?.sin_cambios) {
        return NextResponse.json({ ok: true, accion: `susc_${nuevoEstado}_ya_procesado` });
      }
      if (aplicado?.override) {
        logger.warn("[webhook] plan_override_manual activo, no se cambia el plan", { empresaId, estado: nuevoEstado });
      }

      if (nuevoEstado === "activa") {
        // ═══ P1: las suscripciones que se cancelaron, también en MP ═══
        for (const id of aplicado?.canceladas || []) {
          try {
            await cancelarPreapproval(id);
            logger.debug("[webhook] Preapproval concurrente cancelado en MP", { id });
          } catch (e) {
            logger.error("[webhook] Error cancelando preapproval concurrente", e, { id });
          }
        }
      } else if (nuevoEstado === "suspendida" || nuevoEstado === "cancelada") {
        const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=admin_email,nombre_corto,nombre,slug&limit=1`, { silent: true, fallback: [] });

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
      const ref = leerReferencia(pago.external_reference);
      const empresaId = ref?.empresaId;
      const suscId = ref?.suscId;

      // F2-11: la suscripción del external_reference tiene que ser de esa empresa
      let suscPago = null;
      if (suscId) {
        suscPago = await leerSuscripcion(suscId);
        const control = verificarSuscripcion(suscPago, { empresaId });
        if (!control.ok) {
          logger.warn("[webhook] Pago que no corresponde a la suscripción", { pagoId: pago.id, suscId, empresaId, motivo: control.motivo });
          return NextResponse.json({ ok: true, ignorado: control.motivo });
        }
      }
      // Monto distinto del acordado: el pago se registra, pero no activa el plan
      const montoOk = montoCoincide(suscPago, pago.transaction_amount);

      let estadoPago = "pendiente";
      if (pago.status === "approved") estadoPago = "aprobado";
      else if (pago.status === "rejected") estadoPago = "rechazado";
      else if (pago.status === "refunded") estadoPago = "reembolsado";

      // Idempotencia por (pago, estado) — F1-08. MP reintenta webhooks y además
      // avisa cada cambio de estado del mismo pago (p. ej. pending → approved).
      // Antes se cortaba si el pago ya existía, y un pago que llegaba primero
      // "pendiente" quedaba así para siempre: sin factura ni email de confirmación.
      let pagoRegistrado = null;
      if (pago.id) {
        const existing = await sbGet(`pagos?gateway_payment_id=eq.${pago.id}&select=id,estado&limit=1`);
        const previo = Array.isArray(existing) ? existing[0] : null;
        if (previo && !transicionPagoValida(previo.estado, estadoPago)) {
          // Reintento del mismo estado: no se reprocesa. Si el pago existe pero
          // empresa.plan_activo no fue actualizado (ej: el PATCH falló en el
          // intento anterior), repararlo antes de retornar.
          if (pago.status === "approved" && suscId && empresaId && montoOk) {
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
        if (previo) {
          // Transición de estado: PATCH condicionado al estado anterior, así dos
          // webhooks simultáneos no disparan dos veces la factura ni el email.
          const actualizado = await sbPatch(
            `pagos?id=eq.${previo.id}&estado=eq.${previo.estado}`,
            { estado: estadoPago, fecha_pago: pago.date_approved || pago.date_created },
            { silent: true, fallback: [] }
          );
          if (!Array.isArray(actualizado) || actualizado.length === 0) {
            return NextResponse.json({ ok: true, accion: "pago_ya_procesado" });
          }
          logger.info("[webhook] Pago cambió de estado", { pagoId: pago.id, de: previo.estado, a: estadoPago });
          pagoRegistrado = actualizado[0];
        }
      }

      const [pagoInsertado] = pagoRegistrado ? [pagoRegistrado] : await sbPost("pagos", {
        empresa_id: empresaId || null,
        suscripcion_id: suscId || null,
        monto: pago.transaction_amount,
        moneda: pago.currency_id || "ARS",
        estado: estadoPago,
        gateway: "mercadopago",
        gateway_payment_id: pago.id?.toString(),
        fecha_pago: pago.date_approved || pago.date_created,
      });

      if (estadoPago === "aprobado" && suscId && !montoOk) {
        logger.error("[webhook] Pago aprobado con un monto distinto del acordado: no activa el plan", new Error("monto_no_coincide"), {
          pagoId: pago.id, suscId, empresaId, monto: pago.transaction_amount,
        });
        return NextResponse.json({ ok: true, accion: "pago_monto_no_coincide" });
      }

      if (estadoPago === "aprobado" && suscId) {
        // Suscripción activa y plan de la empresa, juntos (migración 088)
        const aplicado = await sbRpc("aplicar_suscripcion", {
          p_empresa: empresaId,
          p_susc: suscId,
          p_estado: "activa",
          p_datos: null,
          p_cancelar_otras: false,
          p_plan_vence: null,
        });
        if (empresaId) {
          try {
            const [emp] = await sbGet(`empresa?id=eq.${empresaId}&select=admin_email,nombre_corto,nombre,slug`);
            if (emp?.admin_email) {
              sendPagoConfirmado({
                to: emp.admin_email,
                nombre: emp.nombre_corto || emp.nombre,
                empresa: emp.nombre_corto || emp.nombre,
                slug: emp.slug,
                monto: pago.transaction_amount,
                plan: aplicado?.plan || "Pro",
                empresaId,
              });
            }
          } catch (e) { logger.error("Error enviando email pago confirmado", e); }

          // Facturación electrónica ARCA — fire-and-forget, nunca bloquea
          // la activación del plan (ver app/lib/afip.js, kill-switch sin
          // AFIP_ACCESS_TOKEN).
          if (pagoInsertado?.id) {
            try {
              // Factura C al CUIT del cliente (ítem 26). Sin la migración 081 o sin
              // perfil fiscal, sale a Consumidor Final como antes.
              const [fiscal] = await sbGet(
                `empresa?id=eq.${empresaId}&select=razon_social,cuit,condicion_iva,domicilio_fiscal&limit=1`,
                { silent: true, fallback: [] }
              ) || [];
              const receptor = fiscal?.cuit ? fiscal : null;
              const factura = await emitirFacturaC({
                monto: pago.transaction_amount,
                fechaPago: pago.date_approved || pago.date_created,
                periodoInicio: susc?.[0]?.periodo_inicio,
                periodoFin: susc?.[0]?.periodo_fin,
                receptor,
              });
              // Copia de lo informado a ARCA para el comprobante (aparte: si la columna
              // no existe, no se pierde el CAE de abajo)
              if (receptor && factura.ok) await sbPatchOk(`pagos?id=eq.${pagoInsertado.id}`, { receptor });
              if (factura.ok) {
                await sbPatchOk(`pagos?id=eq.${pagoInsertado.id}`, {
                  cae: factura.cae,
                  cae_vencimiento: factura.caeVencimiento,
                  numero_comprobante: factura.numeroComprobante,
                  punto_venta: factura.puntoVenta,
                  tipo_comprobante: factura.tipoComprobante,
                });
              } else if (factura.motivo !== "no_configurado") {
                await sbPatchOk(`pagos?id=eq.${pagoInsertado.id}`, { factura_error: factura.error || "error desconocido" });
              }
            } catch (e) {
              logger.error("[webhook] Error inesperado emitiendo factura", e, { pagoId: pagoInsertado.id });
            }
          }
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
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "gypi-billing-webhook" });
}
