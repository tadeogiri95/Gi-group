import { NextResponse } from "next/server";

// ─── Supabase server-side ───
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CRON_SECRET = process.env.CRON_SECRET; // Para que solo Vercel pueda llamar este endpoint

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ─── DÍAS DE LA SEMANA ───
const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

// ─── GET /api/cron/auto-fichaje ───
// Vercel lo llama automáticamente según el cron configurado en vercel.json
export async function GET(request) {
  // Verificar que la llamada venga de Vercel Cron (seguridad)
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const ahora = new Date();
    // Ajustar a hora Argentina (UTC-3)
    const ahoraAR = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Argentina/Cordoba" }));
    const today = ahoraAR.toISOString().split("T")[0];
    const diaHoy = DIAS_KEY[ahoraAR.getDay()];
    const ahoraMin = ahoraAR.getHours() * 60 + ahoraAR.getMinutes();

    // Traer fichadas de hoy SIN egreso
    const fichadasAbiertas = await sbFetch(
      `fichadas?fecha=eq.${today}&egreso=is.null&egreso_auto=is.null&select=id,legajo`
    );

    if (!fichadasAbiertas || fichadasAbiertas.length === 0) {
      return NextResponse.json({ ok: true, message: "Sin fichadas abiertas", procesados: 0 });
    }

    // Traer empleados activos con diagrama
    const empleados = await sbFetch("empleados?activo=eq.true&select=legajo,nombre,apodo,diagrama");
    const empMap = {};
    for (const e of empleados || []) {
      empMap[e.legajo] = e;
    }

    let procesados = 0;
    const resultados = [];

    for (const fichada of fichadasAbiertas) {
      const emp = empMap[fichada.legajo];
      if (!emp || !emp.diagrama || !emp.diagrama[diaHoy]) continue;

      const salidaProg = emp.diagrama[diaHoy].out;
      if (!salidaProg) continue;

      const [hS, mS] = salidaProg.split(":").map(Number);
      const salidaMin = hS * 60 + mS;

      // Si pasaron más de 3 horas de la salida programada → auto-fichar
      if (ahoraMin > salidaMin + 180) {
        try {
          // Registrar egreso automático
          await sbFetch(`fichadas?id=eq.${fichada.id}`, {
            method: "PATCH",
            body: JSON.stringify({ egreso: salidaProg, egreso_auto: true }),
          });

          // Notificar al operario
          await sbFetch("notificaciones", {
            method: "POST",
            body: JSON.stringify({
              destinatario_rol: String(emp.legajo),
              tipo: "alerta",
              asunto: "⏰ Salida registrada automáticamente",
              detalle: `Se registró tu salida de las ${salidaProg} porque no fichaste al retirarte.`,
              urgencia: "alta",
            }),
          });

          // Notificar a gerencia
          await sbFetch("notificaciones", {
            method: "POST",
            body: JSON.stringify({
              destinatario_rol: "gerencial",
              tipo: "info",
              asunto: `⏰ Auto-fichaje: ${emp.apodo || emp.nombre}`,
              detalle: `Salida ${salidaProg} registrada automáticamente. El operario no fichó su egreso.`,
              urgencia: "normal",
            }),
          });

          // Push notification al operario
          try {
            await fetch(`${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : ""}/api/send-push`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                legajo: String(emp.legajo),
                title: "⏰ Salida auto-registrada",
                body: `Se fichó tu salida de las ${salidaProg} por falta de registro.`,
              }),
            });
          } catch (pushErr) {
            console.error("[CRON] Push error:", pushErr);
          }

          procesados++;
          resultados.push({ legajo: emp.legajo, nombre: emp.apodo || emp.nombre, salida: salidaProg });
        } catch (e) {
          console.error(`[CRON] Error auto-fichaje legajo ${fichada.legajo}:`, e);
          resultados.push({ legajo: fichada.legajo, error: e.message });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      fecha: today,
      hora: `${ahoraAR.getHours()}:${String(ahoraAR.getMinutes()).padStart(2, "0")}`,
      fichadasAbiertas: fichadasAbiertas.length,
      procesados,
      resultados,
    });
  } catch (err) {
    console.error("[CRON] Error general:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
