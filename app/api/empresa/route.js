// app/api/empresa/route.js — VERSIÓN SEGURA
// Si hay token válido → devuelve la empresa de la sesión
// Si NO hay token → devuelve defaults de Gypi (para branding pre-login)
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DEFAULTS = {
  nombre: "Gypi",
  nombre_corto: "Gypi",
  color_primario: "#F97316",
  color_secundario: "#8B5CF6",
  rubro: "general",
  prompt_ia_obra: "",
  prompt_ia_chat: "",
};

async function validarToken(token) {
  if (!token || token.length < 20) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/validar_sesion`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    // Sin token → defaults (para login screen)
    if (!token) return NextResponse.json(DEFAULTS);

    const sesion = await validarToken(token);
    if (!sesion?.empresa_id) return NextResponse.json(DEFAULTS);

    const res = await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${sesion.empresa_id}&select=*&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const data = await res.json();
    if (!data || data.length === 0) return NextResponse.json(DEFAULTS);
    return NextResponse.json(data[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}