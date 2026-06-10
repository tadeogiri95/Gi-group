// ═══════════════════════════════════════════════════════════
// /api/fichar/route.js — REESCRITO: usa REST directo (no RPC)
//
// ENTREGA 1A: validarToken ahora viene de app/lib/auth.js
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { logAudit } from "../../lib/audit";
import { broadcastRefresh } from "../../lib/broadcast";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── REST helpers ───
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`GET ${path}: ${await r.text()}`);
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path}: ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path}: ${await r.text()}`);
  return r.json();
}

// ─── Validación de geolocalización ───
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

    const { accion, geo_lat, geo_lng, forzar_cierre_tarea } = await request.json();
    if (!accion || !["ingreso", "egreso"].includes(accion)) {
      return NextResponse.json({ ok: false, error: "Acción inválida" }, { status: 400 });
    }

    // Timezone de la empresa (un solo fetch liviano, cacheado por Supabase)
    let empresaTz = TZ_DEFAULT;
    try {
      const tzData = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=timezone&limit=1`);
      if (tzData?.[0]?.timezone) empresaTz = tzData[0].timezone;
    } catch { /* usa default */ }

    const { fecha, hora, diaKey } = getLocalTime(empresaTz);
    const empleadoId = sesion.empleado_id;
    const legajo = sesion.legajo;
    const empresaId = sesion.empresa_id;

    // ─── Enforcement de geolocalización (plan Starter+) ───
    try {
      const empRes = await sbGet(`empresa?id=eq.${empresaId}&select=plan_activo&limit=1`);
      const plan = empRes?.[0]?.plan_activo || "free";
      const planesConGeo = ["starter", "pro", "enterprise", "trial"];
      if (planesConGeo.includes(plan)) {
        const zonas = await sbGet(`geo_zonas?empresa_id=eq.${empresaId}&select=lat,lng,radio,label`);
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
      console.error("[fichar] Error validando geolocalización:", e.message);
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
        console.error("[fichar] Error tardanza:", e.message);
      }

      await sbPost("fichadas", {
        empleado_id: empleadoId,
        legajo,
        fecha,
        ingreso: hora,
        llegada_tarde: tardanza.estado === "tarde",
        minutos_tarde: tardanza.minutos || 0,
        empresa_id: empresaId,
      });

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
      return NextResponse.json({ ok: true, hora, tardanza });
    }

    // ═══════════════════════════════════
    // EGRESO
    // ═══════════════════════════════════
    if (!forzar_cierre_tarea) {
      try {
        const activas = await sbGet(
          `registro_actividades?empleado_id=eq.${empleadoId}&hora_fin=is.null&select=id&limit=1`
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
        console.error("[fichar] Error check tareas:", e.message);
      }
    } else {
      try {
        await sbPatch(
          `registro_actividades?empleado_id=eq.${empleadoId}&hora_fin=is.null`,
          { hora_fin: new Date().toISOString() }
        );
      } catch (e) {
        console.error("[fichar] Error cerrando tareas:", e.message);
      }
    }

    const fichadas = await sbGet(
      `fichadas?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}&empresa_id=eq.${empresaId}&select=*`
    );

    if (fichadas.length === 0 || !fichadas[0].ingreso) {
      return NextResponse.json({
        ok: false,
        error: "No tenés fichada de ingreso hoy. Fichá ingreso primero.",
        tipo: "sin_ingreso",
      });
    }

    if (fichadas[0].egreso) {
      return NextResponse.json({
        ok: false,
        error: `Ya fichaste egreso hoy a las ${fichadas[0].egreso.slice(0, 5)}`,
        tipo: "ya_fichado",
      });
    }

    const [hIn, mIn] = fichadas[0].ingreso.split(":").map(Number);
    const [hOut, mOut] = hora.split(":").map(Number);
    const horasTrab = Math.max(0, ((hOut * 60 + mOut) - (hIn * 60 + mIn)) / 60);

    await sbPatch(`fichadas?id=eq.${fichadas[0].id}`, {
      egreso: hora,
      horas_trabajadas: horasTrab.toFixed(2),
    });

    logAudit({
      empresa_id: empresaId,
      actor_id: empleadoId,
      actor_legajo: legajo,
      actor_rol: sesion.rol,
      accion: "fichar_egreso",
      entidad: "fichada",
      ip: request.headers.get("x-forwarded-for") || "unknown",
      datos_despues: { fecha, hora },
    });
    broadcastRefresh(empresaId, "fichadas");
    return NextResponse.json({ ok: true, hora });

  } catch (err) {
    console.error("[fichar] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
