// /api/op/decidir — El CFO aprueba o rechaza una orden de pago desde la
// página /op/<token> (Finanzas F2b, 2; app/lib/ordenPagoCfo.js). Sin usuario
// de Gypi: el token del link es la llave, y solo sirve mientras la orden
// espera la decisión. POST { token, decision: "aprobar"|"rechazar", nombre?, nota? }.
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { decidirOrden } from "../../../lib/ordenPagoCfo";

export async function POST(request) {
  const rl = checkRateLimit(`op-decidir:${ipCliente(request) || "?"}`, 20, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  const d = await request.json().catch(() => null);
  try {
    const r = await decidirOrden(String(d?.token || ""), d?.decision, { nombre: d?.nombre, nota: d?.nota });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, estado: r.estado });
  } catch (err) {
    logger.error("[op/decidir] POST", err);
    return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo." }, { status: 500 });
  }
}
