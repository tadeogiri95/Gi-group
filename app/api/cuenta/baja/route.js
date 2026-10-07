// POST /api/cuenta/baja — El dueño da de baja la cuenta de la empresa
// (F6-01, ítem 28). Body: { confirmacion: "<nombre de la empresa>" }.
// La empresa queda inactiva, se cancela la suscripción de Mercado Pago, se
// cierran todas las sesiones y se manda un email con el link para deshacerla.
// A los 30 días el cron purgar-empresas borra todo.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet, sbPatchOk } from "../../../lib/sbHelpers";
import { cancelarPreapproval } from "../../../lib/mercadopago";
import { confirmacionValida, fechaBorrado, revocarSesionesEmpresa } from "../../../lib/bajaCuenta";
import { signReactivarToken } from "../../../lib/jwt";
import { sendBajaProgramada } from "../../../lib/email";
import { logAudit } from "../../../lib/audit";
import { logger } from "../../../lib/logger";
import { ipCliente } from "../../../lib/ip";

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gypi.app";

export async function POST(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (sesion.rol !== "gerencial") {
    return NextResponse.json({ error: "Solo el dueño de la cuenta puede darla de baja" }, { status: 403 });
  }
  if (sesion.imp) {
    return NextResponse.json({ error: "No se puede dar de baja una cuenta en modo soporte" }, { status: 403 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }

  const e = sesion.empresa_id;
  const [empresa] = (await sbGet(`empresa?id=eq.${e}&select=id,nombre,nombre_corto,slug,admin_email&limit=1`)) || [];
  if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  if (!confirmacionValida(empresa.nombre, body?.confirmacion)) {
    return NextResponse.json({ error: `Para confirmar escribí el nombre de la empresa: ${empresa.nombre}` }, { status: 400 });
  }

  // 1. Que no se le siga cobrando. Si Mercado Pago falla, no se da de baja.
  const subs = (await sbGet(`suscripciones?empresa_id=eq.${e}&estado=eq.activa&gateway=eq.mercadopago&select=id,gateway_subscription_id`)) || [];
  for (const sub of subs) {
    if (!sub.gateway_subscription_id) continue;
    try {
      await cancelarPreapproval(sub.gateway_subscription_id);
      await sbPatchOk(`suscripciones?id=eq.${sub.id}`, { estado: "cancelada" });
    } catch (err) {
      logger.error("[cuenta/baja] no se pudo cancelar la suscripción", err);
      return NextResponse.json({ error: "No pudimos cancelar tu suscripción en Mercado Pago. Probá de nuevo en unos minutos; no se dio de baja nada." }, { status: 502 });
    }
  }

  // 2. Empresa inactiva con la fecha de la baja
  const baja = new Date().toISOString();
  const ok = await sbPatchOk(`empresa?id=eq.${e}`, { activa: false, baja_solicitada_en: baja, suscripcion_activa_id: null });
  if (!ok) return NextResponse.json({ error: "No se pudo dar de baja la cuenta. Probá de nuevo." }, { status: 500 });

  // 3. Nadie sigue adentro (celulares y kioscos)
  try { await revocarSesionesEmpresa(e); } catch (err) { logger.error("[cuenta/baja] sesiones", err); }

  // 4. Email con la fecha de borrado y el link para deshacer
  const borradoEl = fechaBorrado(baja);
  if (empresa.admin_email) {
    try {
      const token = await signReactivarToken({ empresaId: e, baja });
      await sendBajaProgramada({
        to: empresa.admin_email,
        empresa: empresa.nombre_corto || empresa.nombre,
        borradoEl,
        linkReactivar: `${APP_BASE}/reactivar?t=${encodeURIComponent(token)}`,
        empresaId: e,
      });
    } catch (err) { logger.error("[cuenta/baja] email", err); }
  }

  logAudit({
    empresa_id: e,
    actor_id: sesion.empleado_id,
    actor_legajo: sesion.legajo,
    actor_rol: sesion.rol,
    accion: "baja_empresa",
    entidad: "empresa",
    entidad_id: e,
    datos_despues: { baja_solicitada_en: baja, borrado_el: borradoEl, suscripciones_canceladas: subs.length },
    ip: ipCliente(request),
  });

  return NextResponse.json({ ok: true, borrado_el: borradoEl });
}
