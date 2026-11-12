// /api/op/resumen — El CFO aprueba todas las órdenes de un resumen de pagos
// desde la página /op/resumen/<token> (12/11, migración 186;
// app/lib/resumenPagoCfo.js). Sin usuario de Gypi: el token del link es la
// llave. POST { token, nombre? }. Para rechazar una, abre esa orden.
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { aprobarResumen } from "../../../lib/resumenPagoCfo";

export async function POST(request) {
  const rl = checkRateLimit(`op-resumen:${ipCliente(request) || "?"}`, 20, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  const d = await request.json().catch(() => null);
  try {
    const r = await aprobarResumen(String(d?.token || ""), { nombre: d?.nombre });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, aprobadas: r.aprobadas });
  } catch (err) {
    logger.error("[op/resumen] POST", err);
    return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo." }, { status: 500 });
  }
}
