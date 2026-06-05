// app/api/empresa/route.js — Resolución por slug (público) + por token (privado)
import { NextResponse } from "next/server";
import { validarToken } from "../../lib/auth";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const DEFAULTS = {
  nombre: "Gypi",
  nombre_corto: "Gypi",
  color_primario: "#F97316",
  color_secundario: "#8B5CF6",
  rubro: "general",
};

// Campos seguros para exponer pre-login (sin token)
const CAMPOS_PUBLICOS = "id,nombre,nombre_corto,slug,color_primario,color_secundario,logo_url,rubro,activa";

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
    const sesion = await validarToken(request);
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