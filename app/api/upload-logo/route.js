// API: /api/upload-logo/route.js — VERSIÓN SEGURA
// empresa_id se saca del token, no del formData.
// F2-09: solo gestión, sin SVG, contenido verificado por magic bytes y un
// nombre nuevo por subida (sin upsert: nada se sobrescribe).
import { NextResponse } from "next/server";
import { validarToken } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { logger } from "../../lib/logger";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { contenidoCoincide, EXT_POR_MIME } from "../../lib/fileSignature";
import { rechazarSiSupervisor } from "../../lib/alcance";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(request) {
  try {
    // ─── Auth ───
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!ROLES_GESTION.has(sesion.rol)) return NextResponse.json({ error: "Solo gerencia o administración pueden cambiar el logo" }, { status: 403 });
    const bloqueoSupervisor = await rechazarSiSupervisor(sesion);
    if (bloqueoSupervisor) return bloqueoSupervisor;
    const empresaId = sesion.empresa_id;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "file requerido" }, { status: 400 });

    const validTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!validTypes.includes(file.type)) return NextResponse.json({ error: "Solo PNG, JPG o WebP" }, { status: 400 });
    if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Máximo 2MB" }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!contenidoCoincide(bytes, file.type)) {
      return NextResponse.json({ error: "El archivo no es una imagen válida" }, { status: 400 });
    }

    // Nombre nuevo en cada subida: evita el upsert y además rompe el caché del
    // navegador cuando se cambia el logo.
    const fileName = `${empresaId}/logo-${Date.now()}.${EXT_POR_MIME[file.type]}`;

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/logos/${fileName}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": file.type, "x-upsert": "false" },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      logger.error("[upload-logo] Storage error", new Error(errText));
      return NextResponse.json({ error: "Error subiendo el logo" }, { status: 500 });
    }

    const logo_url = `${SB_URL}/storage/v1/object/public/logos/${fileName}`;

    // Forzar empresa del token, ignorar cualquier id del formData
    await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresaId}`, {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ logo_url }),
    });

    return NextResponse.json({ logo_url });
  } catch (err) {
    logger.error("[upload-logo] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
