// ═══════════════════════════════════════════════════════════
// POST /api/billing/webhook
// Recibe notificaciones de MP: pago aprobado, suscripción cancelada, etc.
//
// ENTREGA 1D: Firma HMAC OBLIGATORIA. Si MERCADOPAGO_WEBHOOK_SECRET
// no está configurada, el endpoint retorna 500 en lugar de bypasear.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getPreapproval, getPago } from "../../../lib/mercadopago";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const WH_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.ok;
}
async function sbPost(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error("[webhook] sbPost falló:", await r.text());
  return r.ok ? r.json() : null;
}

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
  return hash === v1;
}

export async function POST(request) {
  try {
    // ═══ CAMBIO 1D: Bloquear si no hay secret configurado ═══
    if (!WH_SECRET) {
      console.error("[webhook] MERCADOPAGO_WEBHOOK_SECRET no configurada — rechazando request");
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
      console.warn("[webhook] Firma HMAC inválida — posible ataque. Headers:", {
        signature: request.headers.get("x-signature")?.slice(0, 30) + "...",
        requestId: request.headers.get("x-request-id"),
        ip: request.headers.get("x-forwarded-for"),
      });
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    const tipo = body.type || body.topic;
    const dataId = body.data?.id || body.id;
    console.log("[webhook] Recibido:", tipo, dataId);

    // ─── Suscripción (preapproval) ───
    if (tipo === "subscription_preapproval" || tipo === "preapproval") {
      const preapproval = await getPreapproval(dataId);
      const externalRef = preapproval.external_reference || "";
      const match = externalRef.match(/^gypi-([0-9a-f-]+)-([0-9a-f-]+)$/i);
      if (!match) {
        console.warn("[webhook] external_reference inválido:", externalRef);
        return NextResponse.json({ ok: true });
      }
      const empresaId = match[1];
      const suscId = match[2];

      let nuevoEstado = "suspendida";
      if (preapproval.status === "authorized") nuevoEstado = "activa";
      else if (preapproval.status === "paused") nuevoEstado = "suspendida";
      else if (preapproval.status === "cancelled") nuevoEstado = "cancelada";
      else if (preapproval.status === "pending") nuevoEstado = "suspendida";

      await sbPatch(`suscripciones?id=eq.${suscId}`, {
        estado: nuevoEstado,
        gateway_customer_id: preapproval.payer_id?.toString() || null,
        periodo_inicio: preapproval.date_created || null,
        periodo_fin: preapproval.next_payment_date || null,
      });

      if (nuevoEstado === "activa") {
        const susc = await sbGet(`suscripciones?id=eq.${suscId}&select=plan`);
        const plan = susc?.[0]?.plan || "free";

        await sbPatch(
          `suscripciones?empresa_id=eq.${empresaId}&estado=in.(trial,activa)&id=neq.${suscId}`,
          { estado: "cancelada" }
        );

        await sbPatch(`empresa?id=eq.${empresaId}`, {
          plan_activo: plan,
          suscripcion_activa_id: suscId,
        });
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
        await sbPatch(`suscripciones?id=eq.${suscId}`, { estado: "activa" });
        if (empresaId) {
          const susc = await sbGet(`suscripciones?id=eq.${suscId}&select=plan`);
          if (susc?.[0]?.plan) {
            await sbPatch(`empresa?id=eq.${empresaId}`, {
              plan_activo: susc[0].plan,
              suscripcion_activa_id: suscId,
            });
          }
        }
      }

      return NextResponse.json({ ok: true, accion: `pago_${estadoPago}` });
    }

    return NextResponse.json({ ok: true, ignorado: tipo });
  } catch (err) {
    if (err.status === 404 || /not found/i.test(err.message)) {
      console.log("[webhook] Recurso no encontrado (simulación o ID viejo):", err.message);
      return NextResponse.json({ ok: true, ignorado: "not_found" });
    }
    console.error("[webhook] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "gypi-billing-webhook" });
}
