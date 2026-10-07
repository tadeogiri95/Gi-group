// POST /api/cuenta/reactivar — Deshace la baja con el link del email
// (F6-01, ítem 28). Body: { token }. Es POST (no un GET en el link) para que
// los antivirus de correo que abren los links no reactiven la cuenta solos.
import { NextResponse } from "next/server";
import { sbGet, sbPatchOk } from "../../../lib/sbHelpers";
import { verifyReactivarToken } from "../../../lib/jwt";
import { puedeReactivar } from "../../../lib/bajaCuenta";
import { limiteExcedido } from "../../../lib/rateLimit";
import { logAudit } from "../../../lib/audit";
import { ipCliente } from "../../../lib/ip";

export async function POST(request) {
  const ip = ipCliente(request);
  if (await limiteExcedido(`reactivar:${ip}`, 10)) {
    return NextResponse.json({ error: "Demasiados intentos. Probá en 15 minutos." }, { status: 429 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const datos = await verifyReactivarToken(body?.token);
  if (!datos) return NextResponse.json({ error: "El link no es válido o venció." }, { status: 400 });

  const [empresa] = (await sbGet(`empresa?id=eq.${datos.empresaId}&select=id,nombre,slug,activa,baja_solicitada_en&limit=1`)) || [];
  if (!empresa) return NextResponse.json({ error: "Los datos de esta empresa ya fueron borrados." }, { status: 410 });
  if (empresa.activa && !empresa.baja_solicitada_en) {
    return NextResponse.json({ ok: true, slug: empresa.slug, yaActiva: true });
  }
  if (!puedeReactivar(empresa, datos.baja)) {
    return NextResponse.json({ error: "Este link ya no sirve: venció o es de una baja anterior." }, { status: 400 });
  }

  const ok = await sbPatchOk(`empresa?id=eq.${empresa.id}`, { activa: true, baja_solicitada_en: null });
  if (!ok) return NextResponse.json({ error: "No se pudo reactivar. Probá de nuevo." }, { status: 500 });

  logAudit({
    empresa_id: empresa.id,
    accion: "reactivar_empresa",
    entidad: "empresa",
    entidad_id: empresa.id,
    datos_antes: { baja_solicitada_en: empresa.baja_solicitada_en },
    ip,
  });
  return NextResponse.json({ ok: true, slug: empresa.slug });
}
