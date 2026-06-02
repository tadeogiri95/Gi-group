// Devuelve la info de suscripción y trial de la empresa del usuario logueado
import { NextResponse } from "next/server";

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
  return d && d.length > 0 ? d[0] : null;
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const sesion = await validarToken(token);
    if (!sesion?.empresa_id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // Suscripción activa (trial o activa) más reciente
    const r = await fetch(
      `${SB_URL}/rest/v1/suscripciones?empresa_id=eq.${sesion.empresa_id}&estado=in.(trial,activa)&order=created_at.desc&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const subs = await r.json();
    const sub = subs?.[0] || null;

    if (!sub) {
      return NextResponse.json({ plan: "free", estado: "activa", trial: null });
    }

    // Calcular días restantes si es trial
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