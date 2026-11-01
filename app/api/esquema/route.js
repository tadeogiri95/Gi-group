// /api/esquema — Chequeo de la base para el dueño (auditoría 01/11, PR 7).
// GET → { faltan: [{ n, archivo, nombre }], metodo, revisado_at }
// Solo Dueño / Gerencia. Solo lee: dice qué migraciones todavía no se
// corrieron en Supabase para avisarlo en el Inicio.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { chequearEsquema } from "../../lib/esquemaServidor";
import { logger } from "../../lib/logger";

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (sesion.rol !== "gerencial") return NextResponse.json({ error: "Solo Dueño / Gerencia" }, { status: 403 });
  try {
    return NextResponse.json(await chequearEsquema(), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    logger.error("[esquema] No se pudo revisar la base", err);
    return NextResponse.json({ error: "No se pudo revisar la base" }, { status: 502 });
  }
}
