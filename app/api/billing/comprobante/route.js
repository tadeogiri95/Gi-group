// GET /api/billing/comprobante?id=<pago> — Factura C para imprimir o guardar
// como PDF (F6-11, ítem 26). Solo el dueño de la cuenta y solo sus pagos.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { htmlComprobante, emisorDesdeEnv } from "../../../lib/comprobante";
import { PLANES } from "../../../lib/plans";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (sesion.rol !== "gerencial") return NextResponse.json({ error: "Solo el dueño de la cuenta ve las facturas" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Comprobante inválido" }, { status: 400 });

  const [pago] = (await sbGet(`pagos?id=eq.${id}&empresa_id=eq.${sesion.empresa_id}&select=*&limit=1`)) || [];
  if (!pago) return NextResponse.json({ error: "No encontramos esa factura" }, { status: 404 });
  if (!pago.cae) return NextResponse.json({ error: "Este pago todavía no tiene factura emitida" }, { status: 409 });

  const [susc] = pago.suscripcion_id
    ? (await sbGet(`suscripciones?id=eq.${pago.suscripcion_id}&select=plan,periodo_inicio,periodo_fin&limit=1`, { silent: true, fallback: [] })) || []
    : [];
  const f = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "");
  const html = await htmlComprobante({
    pago,
    emisor: emisorDesdeEnv(),
    plan: PLANES[susc?.plan]?.nombre || susc?.plan || "",
    periodo: susc?.periodo_inicio ? `${f(susc.periodo_inicio)} al ${f(susc.periodo_fin)}` : "",
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}
