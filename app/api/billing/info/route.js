// ═══════════════════════════════════════════════════════════
// GET /api/billing/info — Info de suscripción y trial
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();

    const r = await fetch(
      `${SB_URL}/rest/v1/suscripciones?empresa_id=eq.${sesion.empresa_id}&estado=in.(trial,activa)&order=created_at.desc&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const subs = await r.json();
    const sub = subs?.[0] || null;

    if (!sub) {
      return NextResponse.json({ plan: "free", estado: "activa", trial: null });
    }

    let dias_restantes = null;
    if (sub.estado === "trial" && sub.trial_fin) {
      const ahora = new Date();
      const fin = new Date(sub.trial_fin);
      dias_restantes = Math.max(0, Math.ceil((fin - ahora) / (1000 * 60 * 60 * 24)));
    }

    return NextResponse.json({
      plan: sub.plan,
      estado: sub.estado,
      precio: sub.precio,
      moneda: sub.moneda,
      gateway: sub.gateway,
      trial_inicio: sub.trial_inicio,
      trial_fin: sub.trial_fin,
      periodo_inicio: sub.periodo_inicio,
      periodo_fin: sub.periodo_fin,
      dias_restantes,
      suscripcion_id: sub.id,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
