// POST /api/actividad — Iniciar o finalizar una tarea (F4-05, ítem 21).
// Antes el celular escribía registro_actividades directo con su propia hora;
// ahora lo decide el servidor, con op_id para que lo enviado al recuperar la
// conexión se registre una sola vez y con la hora en que se hizo (momento).
// Cerrar lo abierto y abrir lo nuevo se hace en una sola transacción con
// registrar_actividad (migración 087, ítem 38).
//
// Body: { accion: "iniciar", etapa, codigo_proyecto?, tipo?, causa?, op_id?, momento? }
//       { accion: "finalizar", observaciones?, op_id?, momento? }
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody } from "../../lib/validate";
import { actividadBody } from "../../lib/schemas";
import { sbGet, sbRpc } from "../../lib/sbHelpers";
import { validarMomento, horaLocal } from "../../lib/offline";
import { unaSolaVez } from "../../lib/operacionesOffline";
import { broadcastRefresh } from "../../lib/broadcast";
import { logger } from "../../lib/logger";
import { safeErrorMessage } from "../../lib/validate";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";

async function procesar(sesion, datos) {
  const { accion, momento } = datos;
  let instante = new Date();
  if (momento) {
    const v = validarMomento(momento);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error, tipo: v.tipo });
    instante = v.fecha;
  }
  const cuando = instante.toISOString();
  const e = sesion.empresa_id;

  let nueva = null;
  if (accion === "iniciar") {
    const [[emp], [empresa]] = await Promise.all([
      sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=division,legajo&limit=1`).then((r) => r || []),
      sbGet(`empresa?id=eq.${e}&select=timezone&limit=1`, { silent: true, fallback: [] }).then((r) => r || []),
    ]);
    const espera = datos.etapa === 0;
    nueva = {
      legajo: String(emp?.legajo ?? sesion.legajo),
      // Fecha del lugar de la empresa, no UTC (F1-10)
      fecha: horaLocal(empresa?.timezone || undefined, instante).fecha,
      // Una tarea siempre lleva OT (lo exige actividadBody); una parada, la OT
      // en la que se estaba si había una (099)
      codigo_proyecto: String(datos.codigo_proyecto ?? "").trim() || null,
      etapa: datos.etapa,
      tipo: datos.tipo || "N",
      causa: espera ? datos.causa : null,
      division: emp?.division || "general",
    };
  }

  // Cerrar lo abierto y abrir la nueva va junto (ítem 38): nunca quedan dos
  // tareas abiertas ni el operario sin tarea por un corte a mitad.
  const r = await sbRpc("registrar_actividad", {
    p_empresa: e,
    p_empleado: sesion.empleado_id,
    p_instante: cuando,
    p_observaciones: accion === "finalizar" ? datos.observaciones || null : null,
    p_nueva: nueva,
  });
  if (!r?.ok) {
    // Algo hecho sin conexión que quedó viejo: ya hay una tarea empezada después
    if (r?.tipo === "desfasada") {
      return NextResponse.json({
        ok: false,
        tipo: "desfasada",
        error: "Esto se hizo sin conexión y después ya se registró otra tarea. Revisá tus tareas de hoy.",
      });
    }
    return NextResponse.json({ ok: false, error: "No se pudo registrar la tarea. Probá de nuevo." }, { status: 404 });
  }
  broadcastRefresh(e, "registro_actividades");
  if (accion === "finalizar") return NextResponse.json({ ok: true, cerradas: r.cerradas });
  return NextResponse.json({ ok: true, tarea: r.tarea || null });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(actividadBody, raw);
    if (parsed.response) return parsed.response;
    // Cuenta en pausa (D20): no se cargan tareas nuevas
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    // Las tareas son parte del módulo "actividad" (Planta; ítem 36). Terminar
    // una que quedó abierta se deja siempre (p. ej. si la empresa cambió de plan).
    if (parsed.data.accion === "iniciar") {
      const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
      if (sinModulo) return sinModulo;
    }
    return await unaSolaVez(sesion, parsed.data.op_id, "actividad", () => procesar(sesion, parsed.data));
  } catch (err) {
    logger.error("[actividad] error", err);
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}
