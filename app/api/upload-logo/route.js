// API: /api/upload-logo/route.js — VERSIÓN SEGURA
// empresa_id se saca del token, no del formData
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

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

export async function POST(request) {
  try {
    // ─── Auth ───
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const sesion = await validarToken(token);
    if (!sesion?.empresa_id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const empresaId = sesion.empresa_id;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "file requerido" }, { status: 400 });

    const validTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!validTypes.includes(file.type)) return NextResponse.json({ error: "Solo PNG, JPG, WebP o SVG" }, { status: 400 });
    if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Máximo 2MB" }, { status: 400 });

    const ext = (file.name.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/g, "");
    const fileName = `${empresaId}/logo.${ext}`;
    const bytes = await file.arrayBuffer();

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/logos/${fileName}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.type, "x-upsert": "true" },
      body: Buffer.from(bytes),
    });
    if (!uploadRes.ok) throw new Error(await uploadRes.text());

    const logo_url = `${SB_URL}/storage/v1/object/public/logos/${fileName}`;

    // Forzar empresa del token, ignorar cualquier id del formData
    await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresaId}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url }),
    });

    return NextResponse.json({ logo_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}