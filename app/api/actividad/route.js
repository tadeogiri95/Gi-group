// POST /api/actividad — Iniciar o finalizar una tarea (F4-05, ítem 21).
// Antes el celular escribía registro_actividades directo con su propia hora;
// ahora lo decide el servidor, con op_id para que lo enviado al recuperar la
// conexión se registre una sola vez y con la hora en que se hizo (momento).
//
// Body: { accion: "iniciar", etapa, codigo_proyecto?, tipo?, causa?, op_id?, momento? }
//       { accion: "finalizar", observaciones?, op_id?, momento? }
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody } from "../../lib/validate";
import { actividadBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { validarMomento, horaLocal } from "../../lib/offline";
import { unaSolaVez } from "../../lib/operacionesOffline";
import { broadcastRefresh } from "../../lib/broadcast";
import { logger } from "../../lib/logger";
import { safeErrorMessage } from "../../lib/validate";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";

const minutosEntre = (inicio, fin) => Math.max(0, Math.round(((Date.parse(fin) - Date.parse(inicio)) / 60000) * 10) / 10);

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

  const abiertas = (await sbGet(
    `registro_actividades?empleado_id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&hora_fin=is.null&select=id,hora_inicio&order=hora_inicio.asc&limit=10`
  )) || [];
  // Algo hecho sin conexión que quedó viejo: ya hay una tarea empezada después
  if (abiertas.some((t) => Date.parse(t.hora_inicio) > instante.getTime())) {
    return NextResponse.json({
      ok: false,
      tipo: "desfasada",
      error: "Esto se hizo sin conexión y después ya se registró otra tarea. Revisá tus tareas de hoy.",
    });
  }

  // Nunca dos tareas abiertas: se cierra lo que haya quedado abierto
  for (const t of abiertas) {
    await sbPatch(`registro_actividades?id=eq.${t.id}&empresa_id=eq.${e}&hora_fin=is.null`, {
      hora_fin: cuando,
      duracion_min: minutosEntre(t.hora_inicio, cuando),
      ...(accion === "finalizar" && datos.observaciones ? { observaciones: datos.observaciones } : {}),
    });
  }

  if (accion === "finalizar") {
    broadcastRefresh(e, "registro_actividades");
    return NextResponse.json({ ok: true, cerradas: abiertas.length });
  }

  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${e}&select=division,legajo&limit=1`)) || [];
  const [empresa] = (await sbGet(`empresa?id=eq.${e}&select=timezone&limit=1`, { silent: true, fallback: [] })) || [];
  const espera = datos.etapa === 0;
  const codigo = espera ? null : String(datos.codigo_proyecto).trim();
  const [creada] = (await sbPost("registro_actividades", {
    empleado_id: sesion.empleado_id,
    legajo: Number(emp?.legajo ?? sesion.legajo),
    // Fecha del lugar de la empresa, no UTC (F1-10)
    fecha: horaLocal(empresa?.timezone || undefined, instante).fecha,
    hora_inicio: cuando,
    codigo_proyecto: codigo,
    etapa: datos.etapa,
    tipo: datos.tipo || "N",
    causa: espera ? datos.causa : null,
    division: emp?.division || "general",
    empresa_id: e,
  })) || [];
  broadcastRefresh(e, "registro_actividades");
  return NextResponse.json({ ok: true, tarea: creada || null });
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
