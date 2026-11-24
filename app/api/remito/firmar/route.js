// /api/remito/firmar — Quien recibió firma el remito desde su link
// (/remito/<token>; Logística, parte 4; migración 206), cuando al entregar no
// había nadie para firmar. Sin usuario de Gypi: el token del link es la llave.
// POST { token, png (firma en base64), nombre, dni? }.
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { firmarRemito } from "../../../lib/logisticaRemitoServidor";

export async function POST(request) {
  const rl = checkRateLimit(`remito-firmar:${ipCliente(request) || "?"}`, 10, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  const d = await request.json().catch(() => null);
  try {
    const r = await firmarRemito(String(d?.token || ""), { png: d?.png, nombre: d?.nombre, dni: d?.dni });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, firma_url: r.firma_url });
  } catch (err) {
    logger.error("[remito/firmar] POST", err);
    return NextResponse.json({ error: "No se pudo guardar la firma. Probá de nuevo." }, { status: 500 });
  }
}
