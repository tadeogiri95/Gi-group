// ═══════════════════════════════════════════════════════════
// POST /api/email/webhook
// Recibe eventos de Resend (sent/delivered/opened/clicked/bounced/
// complained) firmados con Svix. Permite medir engagement de los
// emails transaccionales por tipo y por empresa (vía tags).
//
// Firma OBLIGATORIA: si RESEND_WEBHOOK_SECRET no está configurada,
// el endpoint retorna 500 en lugar de bypasear (mismo criterio que
// el webhook de Mercado Pago).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import crypto from "crypto";
import { sbPost } from "../../../lib/sbHelpers";
import { logger } from "../../../lib/logger";

const WH_SECRET = process.env.RESEND_WEBHOOK_SECRET;

function validarFirma(rawBody, svixId, svixTimestamp, svixSignature) {
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Freshness: más de 5 minutos de diferencia → posible replay
  const tsMs = Number(svixTimestamp) * 1000;
  if (!tsMs || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) return false;

  const secretPart = WH_SECRET.startsWith("whsec_") ? WH_SECRET.slice(6) : WH_SECRET;
  let secretBytes;
  try {
    secretBytes = Buffer.from(secretPart, "base64");
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");

  // svix-signature puede traer varias firmas espaciadas: "v1,sig1 v1,sig2"
  const candidatos = svixSignature.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  return candidatos.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "base64");
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

export async function POST(request) {
  try {
    if (!WH_SECRET) {
      logger.error("RESEND_WEBHOOK_SECRET no configurada — rechazando request");
      return NextResponse.json(
        { ok: false, error: "Webhook no configurado (falta RESEND_WEBHOOK_SECRET)" },
        { status: 500 }
      );
    }

    const rawBody = await request.text();
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!validarFirma(rawBody, svixId, svixTimestamp, svixSignature)) {
      logger.warn("Firma Svix inválida en webhook de email — posible ataque", {
        ip: request.headers.get("x-forwarded-for"),
      });
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: true, ignorado: "json_invalido" });
    }

    const tipo = body.type || ""; // ej: "email.opened"
    const evento = tipo.startsWith("email.") ? tipo.slice(6) : tipo;
    const data = body.data || {};
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const tipoEmail = tags.find((t) => t.name === "tipo")?.value || null;
    const empresaId = tags.find((t) => t.name === "empresa_id")?.value || null;

    await sbPost(
      "email_eventos",
      {
        resend_email_id: data.email_id || null,
        tipo_email: tipoEmail,
        evento,
        empresa_id: empresaId,
        destinatario: Array.isArray(data.to) ? data.to[0] : data.to || null,
        link: data.click?.link || null,
      },
      { silent: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("email webhook error", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "gypi-email-webhook" });
}
