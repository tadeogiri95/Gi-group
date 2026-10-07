// ═══════════════════════════════════════════════════════════
// /api/fichar/route.js — Fichaje del empleado con su sesión.
// La lógica de ingreso/egreso está en lib/ficharServidor.js (compartida con
// el modo kiosco).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { logger } from "../../lib/logger";
import { procesarFichaje } from "../../lib/ficharServidor";

// ═══ POST ═══
export async function POST(request) {
  try {
    // ─── Auth (ahora desde lib/auth.js) ───
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado("Token faltante o sesión inválida");

    // ─── RATE LIMIT (10 fichajes/min por empleado) ───
    const { checkRateLimit } = await import("../../lib/rateLimitMemory");
    const rl = checkRateLimit(`fichar:${sesion.empleado_id}`, 10, 60_000);
    if (rl.limited) {
      return NextResponse.json(
        { ok: false, error: "Demasiados intentos de fichaje. Esperá un momento.", tipo: "rate_limit" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
      );
    }

    const rawBody = await request.json();
    return await procesarFichaje(sesion, rawBody, request);
  } catch (err) {
    logger.error("fichar error", err);
    const { safeErrorMessage } = await import("../../lib/validate");
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}
