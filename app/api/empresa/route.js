// app/api/empresa/route.js — Resolución por slug (público) + por token (privado)
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DEFAULTS = {
  nombre: "Gypi",
  nombre_corto: "Gypi",
  color_primario: "#F97316",
  color_secundario: "#8B5CF6",
  rubro: "general",
};

// Campos seguros para exponer pre-login (sin token)
const CAMPOS_PUBLICOS = "id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,rubro,activa";

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
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    // ─── CASO 1: viene con slug (pre-login, público) ───
    if (slug) {
      const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!slugClean) return NextResponse.json({ error: "slug inválido" }, { status: 400 });

      const res = await fetch(
        `${SB_URL}/rest/v1/empresa?slug=eq.${encodeURIComponent(slugClean)}&select=${CAMPOS_PUBLICOS}&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      const data = await res.json();
      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
      }
      if (data[0].activa === false) {
        return NextResponse.json({ error: "Empresa inactiva" }, { status: 403 });
      }
      return NextResponse.json(data[0]);
    }

    // ─── CASO 2: viene con token (post-login, datos completos) ───
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return NextResponse.json(DEFAULTS);

    const sesion = await validarToken(token);
    if (!sesion?.empresa_id) return NextResponse.json(DEFAULTS);

    const res = await fetch(
      `${SB_URL}/rest/v1/empresa?id=eq.${sesion.empresa_id}&select=*&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return NextResponse.json(DEFAULTS);
    return NextResponse.json(data[0]);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}