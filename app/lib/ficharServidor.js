// ═══════════════════════════════════════════════════════════
// lib/ficharServidor.js — Lógica de fichaje del servidor (ingreso/egreso).
// La usan /api/fichar (sesión del empleado) y el modo kiosco (/api/kiosco/fichar).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { logAudit } from "./audit";
import { broadcastRefresh } from "./broadcast";
import { logger } from "./logger";
import { sbGet, sbPost, sbPatch } from "./sbHelpers";
import { haversine as distanciaMetros, calcularTardanza, parseHoraAMinutos, calcularJornada, normalizarReglasAsistencia, salidaAnticipada } from "./calc";
import { logEvent, EVT } from "./analytics";

import { ipCliente } from "./ip";
import { planVigente } from "./plans";
import { MENSAJE_SIN_PLAN } from "./planEnforcement";
import { validarMomento, horaLocal } from "./offline";
// ─── Hora local según timezone de empresa ───
const TZ_DEFAULT = "America/Argentina/Buenos_Aires";

// Tope de jornada para detectar fichadas olvidadas (egreso varios días
// después del ingreso). No se clampea el valor guardado — un número
// absurdo en horas_trabajadas es una anomalía visible para quien revise
// el reporte de liquidación; un valor recortado a este tope se vería
// plausible y pasaría desapercibido, que es peor.
const MAX_HORAS_JORNADA = 20;
// Cuánto de la imprecisión del GPS del teléfono se perdona al validar la zona
const MARGEN_GPS_MAX_M = 100;
// Por encima de esta precisión el teléfono no está usando GPS (ubicación por red)
const PRECISION_APROXIMADA_M = 500;

/**
 * Registra el ingreso o egreso de `sesion` (empleado_id, empresa_id, legajo, rol).
 * La autenticación y el límite de intentos los hace quien llama.
 * @returns {Promise<Response>}
 */
export async function procesarFichaje(sesion, rawBody, request) {
  try {
    const { ficharBody } = await import("./schemas");
    const { validateBody } = await import("./validate");
    const parsed = validateBody(ficharBody, rawBody);
    if (parsed.response) return parsed.response;
    const { accion, geo_lat, geo_lng, geo_precision, forzar_cierre_tarea, momento } = parsed.data;

    // Timezone y plan de la empresa en una sola consulta
    let empresaTz = TZ_DEFAULT;
    let plan = "free";
    let planLeido = false;
    try {
      const empData = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=timezone,plan_activo&limit=1`);
      if (empData?.[0]?.timezone) empresaTz = empData[0].timezone;
      if (empData?.[0]?.plan_activo) { plan = empData[0].plan_activo; planLeido = true; }
    } catch { /* usa defaults */ }
    // Cuenta en pausa (D20): no se ficha. Si no se pudo leer el plan, no se bloquea.
    if (planLeido && !planVigente(plan)) {
      return NextResponse.json({ ok: false, error: MENSAJE_SIN_PLAN, tipo: "sin_plan" }, { status: 402 });
    }

    // Sin conexión (ítem 21): vale la hora en que se fichó, no la del envío
    let instante = new Date();
    let notaOffline = null;
    if (momento) {
      const v = validarMomento(momento);
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error, tipo: v.tipo });
      instante = v.fecha;
      notaOffline = `Fichada sin conexión, enviada a las ${horaLocal(empresaTz).hora}`;
    }
    const { fecha, hora, diaKey } = horaLocal(empresaTz, instante);
    const empleadoId = sesion.empleado_id;
    const legajo = sesion.legajo;
    const empresaId = sesion.empresa_id;

    // ─── Geolocalización ───
    // Si la empresa tiene zonas cargadas, se ficha solo dentro de una. Si el
    // empleado tiene una ubicación asignada (geo_config), vale solo esa.
    // Antes dependía del plan y el plan Free no controlaba nada.
    try {
      const zonas = await sbGet(`geo_zonas?empresa_id=eq.${empresaId}&select=id,lat,lng,radio,nombre`);
      if (zonas && zonas.length > 0) {
        const [emp] = await sbGet(`empleados?id=eq.${empleadoId}&select=geo_config&limit=1`, { silent: true, fallback: [] }) || [];
        const gc = emp?.geo_config;
        const asignada = gc?.activo && gc.ubicacion_id != null
          ? zonas.filter((z) => String(z.id) === String(gc.ubicacion_id))
          : [];
        const validas = asignada.length > 0 ? asignada : zonas;
        if (geo_lat == null || geo_lng == null) {
          return NextResponse.json({
            ok: false,
            error: "Esta empresa requiere geolocalización para fichar. Habilitá el GPS e intentá de nuevo.",
            tipo: "geo_requerida",
          });
        }
        // El GPS bajo techo puede errar varios cientos de metros: se descuenta la
        // precisión que informa el teléfono, con tope (si no, cualquiera ficha
        // desde lejos declarando una precisión enorme).
        const margen = Math.min(Number(geo_precision) || 0, MARGEN_GPS_MAX_M);
        const medidas = validas.map((z) => {
          // Vale el mayor entre el radio de la zona y el del empleado: el del
          // empleado nace en 150 m por defecto y antes pisaba al de la zona.
          const radio = Math.max(Number(z.radio) || 0, asignada.length > 0 ? Number(gc?.radio) || 0 : 0) || 150;
          const dist = distanciaMetros(geo_lat, geo_lng, Number(z.lat), Number(z.lng));
          return { nombre: z.nombre, radio, dist };
        });
        const dentroDeAlgunaZona = medidas.some((m) => m.dist - margen <= m.radio);
        if (!dentroDeAlgunaZona) {
          const cerca = medidas.reduce((a, b) => (b.dist < a.dist ? b : a));
          const precisionTxt = geo_precision ? `, precisión del GPS ±${Math.round(geo_precision)} m` : "";
          const aproximada = Number(geo_precision) > PRECISION_APROXIMADA_M
            ? ` Tu teléfono está dando una ubicación aproximada (±${Math.round(geo_precision)} m): activá la ubicación precisa del navegador en los ajustes del teléfono y volvé a intentar.`
            : "";
          logAudit({
            empresa_id: empresaId,
            actor_id: empleadoId,
            actor_legajo: legajo,
            actor_rol: sesion.rol,
            accion: "fichaje_fuera_de_zona",
            entidad: "fichada",
            datos_despues: { accion, zona: cerca.nombre, distancia_m: Math.round(cerca.dist), radio_m: cerca.radio, precision_m: geo_precision ?? null },
          });
          return NextResponse.json({
            ok: false,
            error: `Estás fuera de la zona de fichaje: a ${Math.round(cerca.dist)} m de ${cerca.nombre || "la zona"} (radio ${cerca.radio} m${precisionTxt}).${aproximada || " Si estás en el lugar, pedile a tu supervisor que revise la ubicación de la zona."}`,
            tipo: "fuera_de_zona",
            distancia_m: Math.round(cerca.dist),
            radio_m: cerca.radio,
          });
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
    // Reglas de asistencia de la empresa (tolerancia y bloqueos, decisiones D5/D21).
    // Si la columna todavía no existe o falla la lectura: solo tolerancia, sin bloqueos.
    const [reglasRow] = await sbGet(`empresa?id=eq.${empresaId}&select=reglas_asistencia&limit=1`, { silent: true, fallback: [] }) || [];
    const reglasAsistencia = normalizarReglasAsistencia(reglasRow?.reglas_asistencia);

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
          const minEsperado = diagHoy?.in ? parseHoraAMinutos(diagHoy.in) : null;
          const minReal = parseHoraAMinutos(hora);

          if (minEsperado != null && minReal != null) {
            const diff = minReal - minEsperado;

            // Solo consultamos tardanzas previas del mes cuando hace falta
            // (diff>5) — evita una query de DB en el camino feliz (puntual).
            let llegadasPrevias = 0;
            if (diff > reglasAsistencia.tolerancia_min) {
              const mesInicio = fecha.slice(0, 7) + "-01";
              const tardes = await sbGet(
                `fichadas?legajo=eq.${legajo}&empresa_id=eq.${empresaId}&fecha=gte.${mesInicio}&fecha=lte.${fecha}&llegada_tarde=eq.true&select=id`
              );
              llegadasPrevias = tardes.length;
            }

            tardanza = calcularTardanza(diagHoy.in, hora, llegadasPrevias, reglasAsistencia);

            if (tardanza.estado === "bloqueado") {
              return NextResponse.json({
                ok: false,
                error: `${tardanza.motivo}. Necesitás permiso de gerencia.`,
                tipo: tardanza.tipoBloqueo === "minutos" ? "bloqueado_tardanza" : "bloqueado_3ra_tarde",
                tardanza: { estado: tardanza.estado, minutos: tardanza.minutos, llegadasTarde: tardanza.llegadasTarde },
              });
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
          ...(notaOffline ? { notas: notaOffline } : {}),
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
        ip: ipCliente(request),
        datos_despues: { fecha, hora, tardanza: tardanza.estado, ...(notaOffline ? { sin_conexion: true } : {}) },
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
    // Salida antes de hora: si la empresa lo exige, hace falta un permiso
    // aprobado del día. Va antes de cerrar tareas para no tocar nada si se bloquea.
    if (reglasAsistencia.permiso_salida_anticipada) {
      const [abierta] = await sbGet(
        `fichadas?empleado_id=eq.${empleadoId}&empresa_id=eq.${empresaId}&egreso=is.null&select=fecha,ingreso&order=fecha.desc&limit=1`,
        { silent: true, fallback: [] }
      ) || [];
      if (abierta?.ingreso) {
        const [emp] = await sbGet(`empleados?id=eq.${empleadoId}&select=diagrama&limit=1`, { silent: true, fallback: [] }) || [];
        const antes = salidaAnticipada({ fechaIngreso: abierta.fecha, fechaAhora: fecha, horaAhora: hora, diagrama: emp?.diagrama });
        if (antes && antes.minutos > reglasAsistencia.tolerancia_min) {
          const permisos = await sbGet(
            `solicitudes?empresa_id=eq.${empresaId}&empleado_id=eq.${empleadoId}&tipo=eq.salida_anticipada&fecha=eq.${fecha}&select=estado&order=created_at.desc&limit=5`,
            { silent: true, fallback: [] }
          ) || [];
          if (!permisos.some((p) => p.estado === "aprobado")) {
            const pendiente = permisos.some((p) => p.estado === "pendiente");
            return NextResponse.json({
              ok: false,
              error: pendiente
                ? `Tu jornada termina a las ${antes.finGrilla}. Ya pediste permiso para salir antes: esperá a que gerencia lo apruebe y volvé a fichar.`
                : `Tu jornada termina a las ${antes.finGrilla} (faltan ${antes.minutos} min). Para retirarte antes necesitás permiso de gerencia.`,
              tipo: "salida_anticipada",
              pendiente,
              fin_grilla: antes.finGrilla,
            });
          }
        }
      }
    }

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
        // Cerrar una por una para poder calcular duracion_min de cada tarea
        // (los consumidores — chips del empleado, chat IA, reporte mensual —
        // suman esa columna).
        const abiertas = await sbGet(
          `registro_actividades?empleado_id=eq.${empleadoId}&empresa_id=eq.${empresaId}&hora_fin=is.null&select=id,hora_inicio`
        );
        for (const t of abiertas || []) {
          // Con una salida sin conexión, la tarea cierra a esa hora (nunca antes de empezar)
          const cierre = new Date(Math.max(instante.getTime(), Date.parse(t.hora_inicio) || 0)).toISOString();
          const duracion = Math.max(0, Math.round(((new Date(cierre) - new Date(t.hora_inicio)) / 60000) * 10) / 10);
          await sbPatch(`registro_actividades?id=eq.${t.id}&empresa_id=eq.${empresaId}`, {
            hora_fin: cierre,
            duracion_min: duracion,
          });
        }
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

    // 3-4. Horas trabajadas y extra (lib/calc.js calcularJornada): instantes
    //      completos (turno noche) y grilla del día del ingreso. Antes la hora
    //      "08:00:00" de PostgREST producía NaN (F1-01) y el turno noche perdía
    //      la hora extra (F1-11).
    let diagrama = null;
    try {
      const emps = await sbGet(`empleados?id=eq.${empleadoId}&select=diagrama`);
      diagrama = emps?.[0]?.diagrama || null;
    } catch (e) {
      logger.error("Error leyendo el diagrama para horas extra", e);
    }
    const jornada = calcularJornada({
      fechaIngreso: fichada.fecha, horaIngreso: fichada.ingreso,
      fechaEgreso: fecha, horaEgreso: hora, diagrama,
    });
    if (!jornada) {
      logger.error("Fichada con hora de ingreso inválida", new Error(`fichada_id=${fichada.id}`), { ingreso: fichada.ingreso });
      return NextResponse.json({ ok: false, error: "La fichada de ingreso tiene una hora inválida. Avisale a tu supervisor.", tipo: "ingreso_invalido" }, { status: 422 });
    }
    const horasTrab = jornada.horasTrabajadas;
    const { horasExtra, solicitarHoraExtra, datosJornada } = jornada;

    if (horasTrab > MAX_HORAS_JORNADA) {
      logger.error(
        `[FICHAJE_OLVIDADO] Jornada de ${horasTrab.toFixed(2)}h supera el tope de ${MAX_HORAS_JORNADA}h — probable fichaje de ingreso olvidado, revisar manualmente`,
        new Error(`empleado_id=${empleadoId} fichada_id=${fichada.id}`),
        { empleado_id: empleadoId, fichada_id: fichada.id, horas_trabajadas: horasTrab }
      );
    }

    // egreso=is.null en el filtro hace el PATCH atómico ante doble-tap o
    // reintento de red: si otra request ya cerró esta fichada entre el
    // GET de arriba y este PATCH, acá no actualiza nada (0 filas) en vez
    // de pisar el egreso real con una segunda escritura casi idéntica.
    const patched = await sbPatch(`fichadas?id=eq.${fichada.id}&egreso=is.null`, {
      egreso: hora,
      horas_trabajadas: horasTrab.toFixed(2),
      horas_extra: horasExtra,
      ...(notaOffline ? { notas: [fichada.notas, notaOffline].filter(Boolean).join(" · ") } : {}),
    });

    if (!patched || patched.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "Ya fichaste egreso hoy.",
        tipo: "ya_fichado",
      });
    }

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
      ip: ipCliente(request),
      datos_despues: { fecha, hora, horas_extra: horasExtra, ...(notaOffline ? { sin_conexion: true } : {}) },
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
    const { safeErrorMessage } = await import("./validate");
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}
