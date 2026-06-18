// ═══════════════════════════════════════════════════════════
// /api/fichar/route.js — REESCRITO: usa REST directo (no RPC)
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { logAudit } from "../../lib/audit";
import { broadcastRefresh } from "../../lib/broadcast";
import { logger } from "../../lib/logger";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { haversine as distanciaMetros } from "../../lib/calc";
import { logEvent, EVT } from "../../lib/analytics";

// ─── Hora local según timezone de empresa ───
const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const TZ_DEFAULT = "America/Argentina/Buenos_Aires";

function getLocalTime(tz = TZ_DEFAULT) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  const hh = String(local.getHours()).padStart(2, "0");
  const mm = String(local.getMinutes()).padStart(2, "0");
  return {
    fecha: `${y}-${m}-${d}`,
    hora: `${hh}:${mm}`,
    diaKey: DIAS_KEY[local.getDay()],
  };
}

// ═══ POST ═══
export async function POST(request) {
  try {
    // ─── Auth (ahora desde lib/auth.js) ───
    const sesion = await validarToken(request);
    if (!sesion) return respuestaNoAutorizado("Token faltante o sesión inválida");

    // ─── RATE LIMIT (10 fichajes/min por empleado) ───
    const { checkRateLimit } = await import("../../lib/rateLimitMemory");
    const rl = checkRateLimit(`fichar:${sesion.empleado_id}`, 10, 60_000);
    if (rl.limited) {
      return NextResponse.json(
        { ok: false, error: "Demasiados intentos de fichaje. Esperá un momento.", tipo: "rate_limit" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } }
      );
    }

    const rawBody = await request.json();
    const { ficharBody } = await import("../../lib/schemas");
    const { validateBody } = await import("../../lib/validate");
    const parsed = validateBody(ficharBody, rawBody);
    if (parsed.response) return parsed.response;
    const { accion, geo_lat, geo_lng, forzar_cierre_tarea } = parsed.data;

    // Timezone y plan de la empresa en una sola consulta
    let empresaTz = TZ_DEFAULT;
    let plan = "free";
    try {
      const empData = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=timezone,plan_activo&limit=1`);
      if (empData?.[0]?.timezone) empresaTz = empData[0].timezone;
      if (empData?.[0]?.plan_activo) plan = empData[0].plan_activo;
    } catch { /* usa defaults */ }

    const { fecha, hora, diaKey } = getLocalTime(empresaTz);
    const empleadoId = sesion.empleado_id;
    const legajo = sesion.legajo;
    const empresaId = sesion.empresa_id;

    // ─── Enforcement de geolocalización (plan Starter+) ───
    try {
      const planesConGeo = ["starter", "pro", "enterprise", "trial"];
      if (planesConGeo.includes(plan)) {
        const zonas = await sbGet(`geo_zonas?empresa_id=eq.${empresaId}&select=lat,lng,radio,nombre`);
        if (zonas && zonas.length > 0) {
          if (!geo_lat || !geo_lng) {
            return NextResponse.json({
              ok: false,
              error: "Esta empresa requiere geolocalización para fichar. Habilitá el GPS e intentá de nuevo.",
              tipo: "geo_requerida",
            });
          }
          const dentroDeAlgunaZona = zonas.some((z) => {
            const dist = distanciaMetros(geo_lat, geo_lng, Number(z.lat), Number(z.lng));
            return dist <= z.radio;
          });
          if (!dentroDeAlgunaZona) {
            return NextResponse.json({
              ok: false,
              error: "Estás fuera de la zona de fichaje permitida. Acercate al lugar de trabajo.",
              tipo: "fuera_de_zona",
            });
          }
        }
      }
    } catch (e) {
      logger.error("Error validando geolocalización", e);
      return NextResponse.json(
        { ok: false, error: "Error verificando ubicación. Intentá de nuevo en unos segundos.", tipo: "geo_error" },
        { status: 500 }
      );
    }

    // ═══════════════════════════════════
    // INGRESO
    // ═══════════════════════════════════
    if (accion === "ingreso") {
      const existentes = await sbGet(
        `fichadas?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}&empresa_id=eq.${empresaId}&select=id,ingreso`
      );
      if (existentes.length > 0 && existentes[0].ingreso) {
        return NextResponse.json({
          ok: false,
          error: `Ya fichaste ingreso hoy a las ${existentes[0].ingreso.slice(0, 5)}`,
          tipo: "ya_fichado",
        });
      }

      let tardanza = { estado: "puntual", minutos: 0, llegadasTarde: 0 };
      try {
        const emps = await sbGet(`empleados?id=eq.${empleadoId}&select=diagrama`);
        if (emps.length > 0 && emps[0].diagrama) {
          const diagHoy = emps[0].diagrama[diaKey];
          if (diagHoy && diagHoy.in) {
            const [hE, mE] = diagHoy.in.split(":").map(Number);
            const [hR, mR] = hora.split(":").map(Number);
            const diff = (hR * 60 + mR) - (hE * 60 + mE);

            if (diff > 5) {
              const mesInicio = fecha.slice(0, 7) + "-01";
              const tardes = await sbGet(
                `fichadas?legajo=eq.${legajo}&empresa_id=eq.${empresaId}&fecha=gte.${mesInicio}&fecha=lte.${fecha}&llegada_tarde=eq.true&select=id`
              );
              const llegadas = tardes.length + 1;

              if (diff > 30 || llegadas >= 3) {
                tardanza = { estado: "bloqueado", minutos: diff, llegadasTarde: llegadas };
                return NextResponse.json({
                  ok: false,
                  error: diff > 30
                    ? `Tardanza de ${diff} min (supera tolerancia de 30 min). Necesitás permiso de gerencia.`
                    : `3ra llegada tarde del mes. Necesitás permiso de gerencia.`,
                  tipo: diff > 30 ? "bloqueado_tardanza" : "bloqueado_3ra_tarde",
                  tardanza,
                });
              }
              tardanza = { estado: "tarde", minutos: diff, llegadasTarde: llegadas };
            }
          }
        }
      } catch (e) {
        logger.error("Error calculando tardanza", e);
      }

      try {
        await sbPost("fichadas", {
          empleado_id: empleadoId,
          legajo,
          fecha,
          ingreso: hora,
          llegada_tarde: tardanza.estado === "tarde",
          minutos_tarde: tardanza.minutos || 0,
          empresa_id: empresaId,
        });
      } catch (e) {
        if (e.message.includes("23505")) {
          return NextResponse.json({ ok: false, error: `Ya fichaste ingreso hoy a las ${hora.slice(0, 5)}`, tipo: "ya_fichado" });
        }
        throw e;
      }

      if (geo_lat && geo_lng) {
        sbPost("geo_registros", {
          empresa_id: empresaId,
          empleado_id: empleadoId,
          lat: geo_lat,
          lng: geo_lng,
          accion: "ingreso",
        }).catch((e) => logger.error("Error guardando geo_registro ingreso", e));
      }

      logAudit({
        empresa_id: empresaId,
        actor_id: empleadoId,
        actor_legajo: legajo,
        actor_rol: sesion.rol,
        accion: "fichar_ingreso",
        entidad: "fichada",
        ip: request.headers.get("x-forwarded-for") || "unknown",
        datos_despues: { fecha, hora, tardanza: tardanza.estado },
      });
      broadcastRefresh(empresaId, "fichadas");

      // Analytics: detectar primer fichaje de la empresa
      sbGet(`fichadas?empresa_id=eq.${empresaId}&select=id&limit=2`).then(rows => {
        const esPrimero = Array.isArray(rows) && rows.length <= 1;
        if (esPrimero) {
          logEvent(EVT.PRIMER_FICHAJE, { empresa_id: empresaId, empleado_id: empleadoId, plan });
        }
      }).catch(() => {});
      logEvent(EVT.FICHAJE, { empresa_id: empresaId, empleado_id: empleadoId, plan, meta: { accion: "ingreso" } });

      return NextResponse.json({ ok: true, hora, tardanza });
    }

    // ═══════════════════════════════════
    // EGRESO
    // ═══════════════════════════════════
    if (!forzar_cierre_tarea) {
      try {
        const activas = await sbGet(
          `registro_actividades?empleado_id=eq.${empleadoId}&empresa_id=eq.${empresaId}&hora_fin=is.null&select=id&limit=1`
        );
        if (activas.length > 0) {
          return NextResponse.json({
            ok: false,
            error: "Tenés una tarea activa. ¿Querés finalizarla y fichar salida?",
            tipo: "tarea_activa",
            tarea_id: activas[0].id,
          });
        }
      } catch (e) {
        logger.error("Error verificando tareas activas", e);
      }
    } else {
      try {
        await sbPatch(
          `registro_actividades?empleado_id=eq.${empleadoId}&empresa_id=eq.${empresaId}&hora_fin=is.null`,
          { hora_fin: new Date().toISOString() }
        );
      } catch (e) {
        logger.error("Error cerrando tareas activas", e);
      }
    }

    // 1. Buscar la fichada de hoy primero
    const fichadasHoy = await sbGet(
      `fichadas?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}&empresa_id=eq.${empresaId}&select=*&limit=1`
    );

    // Si la de hoy ya tiene egreso → ya fichó salida
    if (fichadasHoy.length > 0 && fichadasHoy[0].egreso) {
      return NextResponse.json({
        ok: false,
        error: `Ya fichaste egreso hoy a las ${fichadasHoy[0].egreso.slice(0, 5)}`,
        tipo: "ya_fichado",
      });
    }

    // 2. Determinar qué fichada usar: la de hoy (si tiene ingreso) o la última
    //    abierta (turno nocturno: ingresó ayer antes de medianoche)
    let fichada = fichadasHoy.length > 0 && fichadasHoy[0].ingreso ? fichadasHoy[0] : null;

    if (!fichada) {
      const [ultima] = await sbGet(
        `fichadas?empleado_id=eq.${empleadoId}&empresa_id=eq.${empresaId}&egreso=is.null&order=fecha.desc&limit=1`
      );
      if (!ultima?.ingreso) {
        return NextResponse.json({
          ok: false,
          error: "No tenés fichada de ingreso hoy. Fichá ingreso primero.",
          tipo: "sin_ingreso",
        });
      }
      fichada = ultima;
    }

    // 3. Calcular horas con aritmética de timestamps — soporta turno nocturno
    const inDate = new Date(`${fichada.fecha}T${fichada.ingreso}:00`);
    const outDate = new Date(`${fecha}T${hora}:00`);
    const horasTrab = Math.max(0, (outDate.getTime() - inDate.getTime()) / 3600000);

    // 4. Calcular horas extra comparando con diagrama
    let horasExtra = 0;
    let solicitarHoraExtra = false;
    let datosJornada = null;
    try {
      const emps = await sbGet(`empleados?id=eq.${empleadoId}&select=diagrama`);
      if (emps.length > 0 && emps[0].diagrama) {
        const diagHoy = emps[0].diagrama[diaKey];
        if (diagHoy && diagHoy.in && diagHoy.out) {
          const [hIn, mIn] = diagHoy.in.split(":").map(Number);
          const [hOut, mOut] = diagHoy.out.split(":").map(Number);
          const [hIngReal, mIngReal] = fichada.ingreso.split(":").map(Number);
          const [hEgReal, mEgReal] = hora.split(":").map(Number);

          const minGrillaIn = hIn * 60 + mIn;
          const minGrillaOut = hOut * 60 + mOut;
          const minIngresoReal = hIngReal * 60 + mIngReal;
          const minEgresoReal = hEgReal * 60 + mEgReal;

          const jornadaGrilla = minGrillaOut - minGrillaIn;
          const jornadaReal = minEgresoReal - minIngresoReal;
          const minutosMasTarde = minEgresoReal - minGrillaOut;

          const fuePuntual = minIngresoReal <= minGrillaIn + 5;

          if (fuePuntual && minutosMasTarde > 0) {
            horasExtra = +(minutosMasTarde / 60).toFixed(2);
          } else if (!fuePuntual && jornadaReal > jornadaGrilla) {
            solicitarHoraExtra = true;
            datosJornada = {
              ingreso_grilla: diagHoy.in,
              egreso_grilla: diagHoy.out,
              ingreso_real: fichada.ingreso,
              egreso_real: hora,
              jornada_grilla_min: jornadaGrilla,
              jornada_real_min: jornadaReal,
              excedente_min: jornadaReal - jornadaGrilla,
            };
          }
        }
      }
    } catch (e) {
      logger.error("Error calculando horas extra", e);
    }

    await sbPatch(`fichadas?id=eq.${fichada.id}`, {
      egreso: hora,
      horas_trabajadas: horasTrab.toFixed(2),
      horas_extra: horasExtra,
    });

    if (geo_lat && geo_lng) {
      sbPost("geo_registros", {
        empresa_id: empresaId,
        empleado_id: empleadoId,
        lat: geo_lat,
        lng: geo_lng,
        accion: "egreso",
      }).catch((e) => logger.error("Error guardando geo_registro egreso", e));
    }

    logAudit({
      empresa_id: empresaId,
      actor_id: empleadoId,
      actor_legajo: legajo,
      actor_rol: sesion.rol,
      accion: "fichar_egreso",
      entidad: "fichada",
      ip: request.headers.get("x-forwarded-for") || "unknown",
      datos_despues: { fecha, hora, horas_extra: horasExtra },
    });
    broadcastRefresh(empresaId, "fichadas");

    const respuesta = { ok: true, hora, horas_extra: horasExtra };
    if (solicitarHoraExtra) {
      respuesta.solicitar_hora_extra = true;
      respuesta.datos_jornada = datosJornada;
    }
    return NextResponse.json(respuesta);

  } catch (err) {
    logger.error("fichar error", err);
    const { safeErrorMessage } = await import("../../lib/validate");
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}
