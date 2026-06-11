// /api/upload/route.js — VERSIÓN SEGURA
// Valida token; el archivo se sube prefijado con empresa_id
import { NextResponse } from "next/server";
import { validarToken } from "../../lib/auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(request) {
  try {
    // ─── Auth ───
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

    const { fileName, fileBase64, fileType } = await request.json();
    if (!fileName || !fileBase64) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (!fileType || !ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
    }

    // ─── Sanitizar fileName y prefijar con empresa_id ───
    // Evita path traversal y aísla archivos por empresa
    const safeName = fileName.replace(/\.\.+/g, "").replace(/^\/+/, "");
    const finalPath = `${sesion.empresa_id}/${safeName}`;

    const buffer = Buffer.from(fileBase64, "base64");
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
    if (buffer.length > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande. Máximo 5 MB." }, { status: 413 });
    }

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