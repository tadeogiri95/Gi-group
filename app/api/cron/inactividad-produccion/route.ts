// GET /api/cron/inactividad-produccion
// Corre cada 10 minutos en horario laboral (lun-vie 10:00-18:00 UTC-3 = 13:00-21:00 UTC).
// Detecta operarios de producción que ficharon ingreso hace >30min pero no tienen
// ningún registro_actividades en los últimos 30 minutos, y les envía push notification.
//
// Objetivo: alertar al operario si pasó media hora sin registrar tarea ni tiempo muerto.

import { NextResponse } from "next/server";
import admin from "firebase-admin";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;
const UMBRAL_MIN = 30;

interface Empleado {
  id: string;
  legajo: number;
  nombre: string;
  empresa_id: string;
}

interface Fichada {
  empleado_id: string;
  legajo: number;
  ingreso: string;
  egreso: string | null;
  empresa_id: string;
}

interface RegistroAct {
  empleado_id: string;
  hora_inicio: string;
  hora_fin: string | null;
}

interface PushToken {
  token: string;
  legajo: number;
  empresa_id: string;
}

async function sbGet<T = unknown>(path: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) return [];
  return r.json();
}

function getFirebaseApp() {
  if (admin.apps.length > 0) return admin.app();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const raw = rawJson || (rawB64 ? Buffer.from(rawB64, "base64").toString("utf-8") : null);
  if (!raw) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT o FIREBASE_SERVICE_ACCOUNT_B64");
  return admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL?.includes("localhost")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const ahora = new Date();
    const hoy = ahora.toISOString().slice(0, 10);
    const hace30 = new Date(ahora.getTime() - UMBRAL_MIN * 60 * 1000).toISOString();

    // Empleados operativos de producción que ficharon HOY y siguen en planta (sin egreso)
    const fichadasAbiertas = await sbGet<Fichada>(
      `fichadas?fecha=eq.${hoy}&egreso=is.null&select=empleado_id,legajo,ingreso,egreso,empresa_id`
    );

    if (!fichadasAbiertas.length) {
      return NextResponse.json({ ok: true, msg: "Sin fichadas abiertas", notificados: 0 });
    }

    // Filtrar solo los que ficharon hace más de 30 min
    const enPlanta = fichadasAbiertas.filter(f => {
      const ingresoTime = new Date(`${hoy}T${f.ingreso}`).getTime();
      return ingresoTime < ahora.getTime() - UMBRAL_MIN * 60 * 1000;
    });

    if (!enPlanta.length) {
      return NextResponse.json({ ok: true, msg: "Todos ficharon hace <30min", notificados: 0 });
    }

    const empleadoIds = enPlanta.map(f => f.empleado_id);

    // Obtener registros de actividad de los últimos 30 min para estos empleados
    const actividades = await sbGet<RegistroAct>(
      `registro_actividades?fecha=eq.${hoy}&empleado_id=in.(${empleadoIds.join(",")})&hora_inicio=gte.${hace30}&select=empleado_id,hora_inicio,hora_fin`
    );

    // También considerar tareas activas (hora_fin null con hora_inicio reciente no es inactividad)
    const tareasActivas = await sbGet<RegistroAct>(
      `registro_actividades?fecha=eq.${hoy}&empleado_id=in.(${empleadoIds.join(",")})&hora_fin=is.null&select=empleado_id,hora_inicio,hora_fin`
    );

    const conActividad = new Set([
      ...actividades.map(a => a.empleado_id),
      ...tareasActivas.map(a => a.empleado_id),
    ]);

    // Empleados inactivos: en planta >30min sin registro reciente ni tarea abierta
    const inactivos = enPlanta.filter(f => !conActividad.has(f.empleado_id));

    if (!inactivos.length) {
      return NextResponse.json({ ok: true, msg: "Todos tienen actividad reciente", notificados: 0 });
    }

    // Obtener tokens push de los inactivos
    const legajosInactivos = inactivos.map(f => f.legajo);
    const tokens = await sbGet<PushToken>(
      `push_tokens?legajo=in.(${legajosInactivos.join(",")})&select=token,legajo,empresa_id`
    );

    if (!tokens.length) {
      return NextResponse.json({ ok: true, msg: "Sin tokens push para inactivos", notificados: 0, inactivos: inactivos.length });
    }

    let app: ReturnType<typeof admin.app>;
    try {
      app = getFirebaseApp();
    } catch (e) {
      logger.error("[cron/inactividad] Firebase no configurado", e as Error);
      return NextResponse.json({ error: "Firebase no configurado" }, { status: 500 });
    }

    const messaging = admin.messaging(app);
    let enviados = 0;
    const tokensInvalidos: string[] = [];

    await Promise.allSettled(
      tokens.map(async (t) => {
        try {
          await messaging.send({
            token: t.token,
            notification: {
              title: "⏱ Sin registro de actividad",
              body: "Pasaron 30 min sin que registres tarea o tiempo muerto. ¿Estás en algo?",
            },
            data: {
              empresa_id: t.empresa_id,
              tipo: "inactividad_produccion",
              legajo: String(t.legajo),
            },
            webpush: {
              notification: {
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                requireInteraction: true,
              },
            },
          });
          enviados++;
        } catch (err: unknown) {
          const code = (err as { errorInfo?: { code?: string }; code?: string })?.errorInfo?.code
            || (err as { code?: string })?.code || "";
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument"
          ) {
            tokensInvalidos.push(t.token);
          }
        }
      })
    );

    // Limpiar tokens inválidos
    if (tokensInvalidos.length) {
      const list = tokensInvalidos.map((tk) => `token=eq.${encodeURIComponent(tk)}`).join(",");
      fetch(`${SB_URL}/rest/v1/push_tokens?or=(${list})`, {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      }).catch(() => {});
    }

    logger.info(`[cron/inactividad] ${enviados} push enviados, ${inactivos.length} inactivos detectados`);

    return NextResponse.json({
      ok: true,
      inactivos: inactivos.length,
      notificados: enviados,
      tokensLimpiados: tokensInvalidos.length,
    });
  } catch (err) {
    logger.error("[cron/inactividad] Error", err as Error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
