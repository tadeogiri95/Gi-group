// /api/upload/route.js — VERSIÓN SEGURA
// Valida token; el archivo se sube prefijado con empresa_id
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function validarToken(token) {
  if (!token || token.length < 20) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validar_sesion`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
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
    if (!sesion?.empresa_id) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

    const { fileName, fileBase64, fileType } = await request.json();
    if (!fileName || !fileBase64) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    // ─── Sanitizar fileName y prefijar con empresa_id ───
    // Evita path traversal y aísla archivos por empresa
    const safeName = fileName.replace(/\.\.+/g, "").replace(/^\/+/, "");
    const finalPath = `${sesion.empresa_id}/${safeName}`;

    const buffer = Buffer.from(fileBase64, "base64");

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/reportes-obra/${finalPath}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": fileType || "image/jpeg",
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (res.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/reportes-obra/${finalPath}`;
      return NextResponse.json({ ok: true, url: publicUrl });
    }
    const errText = await res.text();
    console.error("[upload] Storage error:", errText);
    return NextResponse.json({ ok: false, error: errText }, { status: 500 });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}