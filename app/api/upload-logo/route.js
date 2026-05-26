// ═══════════════════════════════════════════════════════════
// API: /api/upload-logo/route.js
// Sube un logo a Supabase Storage y devuelve la URL pública
// ═══════════════════════════════════════════════════════════
import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const empresaId = formData.get("empresa_id");

    if (!file || !empresaId) {
      return NextResponse.json({ error: "file y empresa_id requeridos" }, { status: 400 });
    }

    const validTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: "Solo PNG, JPG, WebP o SVG" }, { status: 400 });
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Máximo 2MB" }, { status: 400 });
    }

    const ext = file.name.split(".").pop() || "png";
    const fileName = `${empresaId}/logo.${ext}`;
    const bytes = await file.arrayBuffer();

    const uploadRes = await fetch(
      `${SB_URL}/storage/v1/object/logos/${fileName}`,
      {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": file.type,
          "x-upsert": "true",
        },
        body: Buffer.from(bytes),
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(err);
    }

    const logo_url = `${SB_URL}/storage/v1/object/public/logos/${fileName}`;

    await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresaId}`, {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ logo_url }),
    });

    return NextResponse.json({ logo_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
