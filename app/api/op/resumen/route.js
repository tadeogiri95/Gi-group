// /api/op/resumen — El CFO aprieta 👍 Visto en la página /op/resumen/<token>
// de un resumen de pagos (12/11, migración 186; desde el 13/11 solo
// informativo: el pago no depende de esto; app/lib/resumenPagoCfo.js). Sin
// usuario de Gypi: el token del link es la llave. POST { token, nombre? }.
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { resumenVisto } from "../../../lib/resumenPagoCfo";

export async function POST(request) {
  const rl = checkRateLimit(`op-resumen:${ipCliente(request) || "?"}`, 20, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  const d = await request.json().catch(() => null);
  try {
    const r = await resumenVisto(String(d?.token || ""), { nombre: d?.nombre });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, vistas: r.vistas });
  } catch (err) {
    logger.error("[op/resumen] POST", err);
    return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo." }, { status: 500 });
  }
}
