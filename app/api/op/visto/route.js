// /api/op/visto — El CFO aprieta 👍 Visto en la página /op/<token> de una
// orden de pago (13/11; antes era /api/op/decidir con Aprobar / Rechazar).
// Solo avisa al dueño que la vio: el pago no depende de esto. Sin usuario de
// Gypi: el token del link es la llave. POST { token, nombre? }.
import { NextResponse } from "next/server";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { marcarVisto } from "../../../lib/ordenPagoCfo";

export async function POST(request) {
  const rl = checkRateLimit(`op-visto:${ipCliente(request) || "?"}`, 20, 60_000);
  if (rl.limited) return NextResponse.json({ error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  const d = await request.json().catch(() => null);
  try {
    const r = await marcarVisto(String(d?.token || ""), { nombre: d?.nombre });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, estado: r.estado, visto: r.visto });
  } catch (err) {
    logger.error("[op/visto] POST", err);
    return NextResponse.json({ error: "No se pudo guardar. Probá de nuevo." }, { status: 500 });
  }
}
