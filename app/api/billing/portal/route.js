// ═══════════════════════════════════════════════════════════
// POST /api/billing/portal — Cancelar suscripción activa
// GET  /api/billing/portal — Link al historial de MP
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { cancelarPreapproval } from "../../../lib/mercadopago";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return r.json();
}

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

    const subs = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&estado=eq.activa&gateway=eq.mercadopago&order=created_at.desc&limit=1`
    );
    const sub = subs?.[0];
    if (!sub) return NextResponse.json({ error: "No tenés una suscripción activa en Mercado Pago" }, { status: 404 });
    if (!sub.gateway_subscription_id) return NextResponse.json({ error: "Suscripción sin ID de MP" }, { status: 400 });

    await cancelarPreapproval(sub.gateway_subscription_id);

    return NextResponse.json({ ok: true, mensaje: "Suscripción cancelada. Seguirás en el plan actual hasta el fin del período pago." });
  } catch (err) {
    console.error("[billing/portal] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
