// /api/proyectos/link-cliente — Link de la OT para el cliente (04/11;
// app/lib/linkClienteOt.js). POST { ot } → { url }: el link firmado de la
// página /ot/<código>, para el QR, copiar o mandar por WhatsApp. Solo gestión
// y solo OT de su empresa. El link no se guarda: se calcula cada vez.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { sbGet } from "../../../lib/sbHelpers";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { linkClienteOt } from "../../../lib/linkClienteOt";
import { logger } from "../../../lib/logger";

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo la oficina puede sacar el link para el cliente" }, { status: 403 });
    }
    const sinModulo = await requireModuloSesion(sesion, "proyectos");
    if (sinModulo) return sinModulo;
    const body = await request.json().catch(() => ({}));
    const ot = String(body?.ot ?? "").trim();
    if (!/^[\w.-]{1,40}$/.test(ot)) return NextResponse.json({ error: "OT inválida" }, { status: 400 });
    const [p] = (await sbGet(`proyectos?empresa_id=eq.${sesion.empresa_id}&ot=eq.${encodeURIComponent(ot)}&select=ot&limit=1`, { sesion })) || [];
    if (!p) return NextResponse.json({ error: "No existe esa OT" }, { status: 404 });
    const origen = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json({ ok: true, url: linkClienteOt(origen, sesion.empresa_id, p.ot) });
  } catch (err) {
    logger.error("[proyectos/link-cliente] POST error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
