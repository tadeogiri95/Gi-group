// /api/upload/route.js — VERSIÓN SEGURA
// Valida token; el archivo se sube con nombre generado en el servidor,
// prefijado con empresa_id, sin SVG y verificando el contenido real (F2-09)
import { NextResponse } from "next/server";
import { rechazarSiSinPlan } from "../../lib/planEnforcement";
import { validarToken } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { logger } from "../../lib/logger";
import { contenidoCoincide, EXT_POR_MIME } from "../../lib/fileSignature";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(request) {
  try {
    // ─── Auth ───
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;

    // fileName se sigue aceptando por compatibilidad, pero ya no se usa: el
    // nombre lo genera el servidor (F2-09), así nadie puede pisar un archivo ajeno.
    const { fileBase64, fileType } = await request.json();
    if (!fileBase64 || typeof fileBase64 !== "string") return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    // Sin SVG: puede llevar scripts y el bucket es público (F2-09)
    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!fileType || !ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
    }

    const buffer = Buffer.from(fileBase64, "base64");
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
    if (buffer.length > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande. Máximo 5 MB." }, { status: 413 });
    }
    // El contenido real tiene que ser el tipo declarado (no confiar en el navegador)
    if (!contenidoCoincide(buffer, fileType)) {
      return NextResponse.json({ error: "El archivo no es una imagen válida" }, { status: 400 });
    }

    // Nombre generado en el servidor y prefijado con la empresa
    const finalPath = `${sesion.empresa_id}/${randomUUID()}.${EXT_POR_MIME[fileType]}`;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/reportes-obra/${finalPath}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": fileType,
        "x-upsert": "false",
      },
      body: buffer,
    });

    if (res.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/reportes-obra/${finalPath}`;
      return NextResponse.json({ ok: true, url: publicUrl });
    }
    const errText = await res.text();
    logger.error("[upload] Storage error", new Error(errText));
    return NextResponse.json({ ok: false, error: "Error subiendo el archivo" }, { status: 500 });
  } catch (err) {
    logger.error("[upload] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}