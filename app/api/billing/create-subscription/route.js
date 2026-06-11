// ═══════════════════════════════════════════════════════════
// POST /api/billing/create-subscription
// Body: { plan: "starter" | "pro" }
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { crearPreapproval } from "../../../lib/mercadopago";
import { PLANES } from "../../../lib/plans";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return r.json();
}

async function sbPost(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Solo el administrador puede cambiar el plan" }, { status: 403 });
    }

    const { plan } = await request.json();
    if (!plan || !["starter", "pro"].includes(plan)) {
      return NextResponse.json({ error: "Plan inválido. Usá 'starter' o 'pro'." }, { status: 400 });
    }

    const planInfo = PLANES[plan];
    if (!planInfo?.precio) return NextResponse.json({ error: "Plan sin precio configurado" }, { status: 400 });

    const emp = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=admin_email,nombre,slug`);
    if (!emp?.[0]) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    const empresa = emp[0];
    const payerEmail = empresa.admin_email;
    if (!payerEmail) return NextResponse.json({ error: "La empresa no tiene email de admin configurado" }, { status: 400 });

    const localSusc = await sbPost("suscripciones", {
      empresa_id: sesion.empresa_id,
      plan,
      estado: "suspendida",
      precio: planInfo.precio,
      moneda: "ARS",
      gateway: "mercadopago",
    });
    const suscId = localSusc[0].id;

    const externalRef = `gypi-${sesion.empresa_id}-${suscId}`;
    const backUrl = `${APP_URL}/${empresa.slug || ""}?billing=ok`;

    let mp;
    try {
      mp = await crearPreapproval({
        payerEmail,
        monto: planInfo.precio,
        plan: planInfo.nombre,
        empresaId: sesion.empresa_id,
        externalReference: externalRef,
        backUrl,
      });
    } catch (err) {
      console.error("[create-subscription] Error MP:", err.message, err.body);
      return NextResponse.json({ error: `Error de Mercado Pago: ${err.message}` }, { status: 500 });
    }

    await fetch(`${SB_URL}/rest/v1/suscripciones?id=eq.${suscId}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ gateway_subscription_id: mp.id }),
    });

    return NextResponse.json({
      ok: true,
      init_point: mp.init_point,
      suscripcion_id: suscId,
      mp_preapproval_id: mp.id,
    });
  } catch (err) {
    console.error("[create-subscription] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
