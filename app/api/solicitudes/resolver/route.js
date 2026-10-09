// POST /api/solicitudes/resolver — Aprobar o rechazar una solicitud (ítem 38;
// auditoría F1-12). Antes la bandeja escribía desde el celular en pasos
// sueltos; ahora el servidor arma todo y lo guarda junto con la función
// resolver_solicitud (migración 086): o se guarda todo, o nada. Si otra
// persona ya la resolvió, responde 409 y no escribe nada.
//
// Body: { id, estado: "aprobado" | "rechazado", nota? }
// Devuelve: { ok, push: { legajo, titulo, cuerpo } } — el aviso al celular lo
// manda la bandeja con /api/send-push, como antes.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { validateBody, safeErrorMessage } from "../../../lib/validate";
import { resolverSolicitudBody } from "../../../lib/schemas";
import { sbGet, sbRpc } from "../../../lib/sbHelpers";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { alcanceDe, dentroDelAlcance, respuestaFueraDeAlcance } from "../../../lib/alcance";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { horaLocal } from "../../../lib/offline";
import { buscarHoraExtraAprobable, planResolucion } from "../../../lib/solicitudes";
import { broadcastRefresh } from "../../../lib/broadcast";
import { logger } from "../../../lib/logger";

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ ok: false, error: "Solo gestión puede responder pedidos" }, { status: 403 });
    }
    const parsed = validateBody(resolverSolicitudBody, await request.json().catch(() => null));
    if (parsed.response) return parsed.response;
    const { id, estado, nota } = parsed.data;
    const e = sesion.empresa_id;

    const sinPlan = await rechazarSiSinPlan(e);
    if (sinPlan) return sinPlan;

    const [sol] = (await sbGet(`solicitudes?id=eq.${id}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
    if (!sol) return NextResponse.json({ ok: false, error: "Ese pedido no existe" }, { status: 404 });
    // Un supervisor de división solo responde pedidos de su gente (D2)
    if (!dentroDelAlcance(await alcanceDe(sesion), { id: sol.empleado_id, legajo: sol.legajo })) return respuestaFueraDeAlcance();
    if (sol.estado !== "pendiente") {
      return NextResponse.json({ ok: false, tipo: "ya_resuelta", error: "Otra persona ya respondió este pedido." }, { status: 409 });
    }

    const [[yo], [empresa]] = await Promise.all([
      sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=apodo,nombre&limit=1`).then((r) => r || []),
      sbGet(`empresa?id=eq.${e}&select=timezone&limit=1`, { silent: true, fallback: [] }).then((r) => r || []),
    ]);
    const tz = empresa?.timezone || undefined;
    const aprobador = yo?.apodo || yo?.nombre || "Gestión";
    const horaExtra = sol.tipo === "hora_extra" && estado === "aprobado"
      ? await buscarHoraExtraAprobable((path) => sbGet(`${path}&empresa_id=eq.${e}`), sol)
      : null;

    const plan = planResolucion({
      sol,
      estado,
      nota: nota || "",
      aprobador,
      hoy: horaLocal(tz).fecha,
      horaCreacion: horaLocal(tz, sol.created_at ? new Date(sol.created_at) : new Date()).hora,
      horaExtra,
    });

    const resultado = await sbRpc("resolver_solicitud", {
      p_empresa: e,
      p_id: id,
      p_estado: estado,
      p_aprobador: aprobador,
      p_nota: nota || "",
      p_fichada: plan.fichada,
      p_horas_extra: plan.horasExtra,
      p_notificacion: plan.notificacion,
    });
    if (resultado === "ya_resuelta") {
      return NextResponse.json({ ok: false, tipo: "ya_resuelta", error: "Otra persona ya respondió este pedido." }, { status: 409 });
    }
    if (resultado !== "ok") {
      return NextResponse.json({ ok: false, error: "Ese pedido no existe" }, { status: 404 });
    }

    broadcastRefresh(e, "solicitudes");
    broadcastRefresh(e, "notificaciones");
    return NextResponse.json({ ok: true, push: { legajo: String(sol.legajo), ...plan.push } });
  } catch (err) {
    logger.error("[solicitudes/resolver] error", err);
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}
