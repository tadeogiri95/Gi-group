// ═══════════════════════════════════════════════════════════
// /api/fichar/route.js — REESCRITO: usa REST directo (no RPC)
// Ya no depende de funciones SQL fichar_ingreso/fichar_egreso
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión (RPC que sí funciona) ───
async function validarToken(token) {
  if (!token || token.length < 20) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validar_sesion`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

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

// ─── Hora Argentina ───
const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

function getArgTime() {
  const now = new Date();
  const arg = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const y = arg.getFullYear();
  const m = String(arg.getMonth() + 1).padStart(2, "0");
  const d = String(arg.getDate()).padStart(2, "0");
  const hh = String(arg.getHours()).padStart(2, "0");
  const mm = String(arg.getMinutes()).padStart(2, "0");
  return {
    fecha: `${y}-${m}-${d}`,
    hora: `${hh}:${mm}`,
    diaKey: DIAS_KEY[arg.getDay()],
  };
}

// ═══ POST ═══
export async function POST(request) {
  try {
    // ─── Auth ───
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ ok: false, error: "Token faltante" }, { status: 401 });

    const sesion = await validarToken(token);
    if (!sesion) return NextResponse.json({ ok: false, error: "Sesión inválida o expirada" }, { status: 401 });

    const { accion, geo_lat, geo_lng, geo_distancia, forzar_cierre_tarea } = await request.json();
    if (!accion || !["ingreso", "egreso"].includes(accion)) {
      return NextResponse.json({ ok: false, error: "Acción inválida" }, { status: 400 });
    }

    const { fecha, hora, diaKey } = getArgTime();
    const empleadoId = sesion.empleado_id;
    const legajo = sesion.legajo;
    const empresaId = sesion.empresa_id;

    // ═══════════════════════════════════
    // INGRESO
    // ═══════════════════════════════════
    if (accion === "ingreso") {
      // ¿Ya fichó hoy?
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

      // Chequear tardanza
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
              // Contar tardes del mes
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

      // Crear fichada
      await sbPost("fichadas", {
        empleado_id: empleadoId,
        legajo,
        fecha,
        ingreso: hora,
        llegada_tarde: tardanza.estado === "tarde",
        minutos_tarde: tardanza.minutos || 0,
        empresa_id: empresaId,
      });

      return NextResponse.json({ ok: true, hora, tardanza });
    }

    // ═══════════════════════════════════
    // EGRESO
    // ═══════════════════════════════════
    // Chequear tarea activa
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
        // Tabla puede no existir, seguir
        console.error("[fichar] Error check tareas:", e.message);
      }
    } else {
      // Cerrar tareas activas
      try {
        await sbPatch(
          `registro_actividades?empleado_id=eq.${empleadoId}&hora_fin=is.null`,
          { hora_fin: new Date().toISOString() }
        );
      } catch (e) {
        console.error("[fichar] Error cerrando tareas:", e.message);
      }
    }

    // Buscar fichada de hoy
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

    // Calcular horas
    const [hIn, mIn] = fichadas[0].ingreso.split(":").map(Number);
    const [hOut, mOut] = hora.split(":").map(Number);
    const horasTrab = Math.max(0, ((hOut * 60 + mOut) - (hIn * 60 + mIn)) / 60);

    // Actualizar fichada
    await sbPatch(`fichadas?id=eq.${fichadas[0].id}`, {
      egreso: hora,
      horas_trabajadas: horasTrab.toFixed(2),
    });

    return NextResponse.json({ ok: true, hora });

  } catch (err) {
    console.error("[fichar] Error:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
