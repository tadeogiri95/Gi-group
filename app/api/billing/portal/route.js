// ═══════════════════════════════════════════════════════════
// POST /api/billing/portal — Cancelar suscripción activa
// GET  /api/billing/portal — Devuelve link al historial de MP del usuario
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { cancelarPreapproval } from "../../../lib/mercadopago";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function validarToken(token) {
  if (!token || token.length < 20) return null;
  const r = await fetch(`${SB_URL}/rest/v1/rpc/validar_sesion`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.[0] || null;
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return r.json();
}

export async function GET(request) {
  // Link al panel de suscripciones del usuario en MP
  return NextResponse.json({
    portal_url: "https://www.mercadopago.com.ar/subscriptions",
    descripcion: "Gestioná tu suscripción y métodos de pago en Mercado Pago",
  });
}

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const sesion = await validarToken(token);
    if (!sesion?.empresa_id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // Buscar suscripción activa pagada en MP
    const subs = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&estado=eq.activa&gateway=eq.mercadopago&order=created_at.desc&limit=1`
    );
    const sub = subs?.[0];
    if (!sub) return NextResponse.json({ error: "No tenés una suscripción activa en Mercado Pago" }, { status: 404 });
    if (!sub.gateway_subscription_id) return NextResponse.json({ error: "Suscripción sin ID de MP" }, { status: 400 });

    // Cancelar en MP (el webhook va a actualizar el estado local)
    await cancelarPreapproval(sub.gateway_subscription_id);

    return NextResponse.json({ ok: true, mensaje: "Suscripción cancelada. Seguirás en el plan actual hasta el fin del período pago." });
  } catch (err) {
    console.error("[billing/portal] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}