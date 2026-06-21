// GET /api/cron/push-ausencias
// Corre los días hábiles (lun-vie) a las 15:00 UTC (12:00 noon Argentina).
// Detecta empleados con turno programado para hoy que no ficharon entrada
// y envía push notification a los gerenciales de cada empresa afectada.
//
// Riesgo si no se hace: ausencias pasan desapercibidas hasta que alguien
// revisa el dashboard — la gerencia pierde visibilidad en tiempo real.

import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Nombre de cada día según la clave del diagrama de empleados
const DIAS_CLAVE = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
type DiaClave = (typeof DIAS_CLAVE)[number];

async function sbGet<T = unknown>(path: string): Promise<T[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`sbGet ${path}: ${await r.text()}`);
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

async function enviarPushGerencia(
  empresaId: string,
  totalAusentes: number,
  fecha: string
): Promise<number> {
  // Obtener tokens de gerenciales/administrativos de esta empresa
  const empleadosGer = await sbGet<{ legajo: number }>(
    `empleados?empresa_id=eq.${empresaId}&rol=in.(gerencial,administrativo)&activo=eq.true&select=legajo`
  );
  if (!empleadosGer.length) return 0;

  const legajos = empleadosGer.map((e) => e.legajo).join(",");
  const tokens = await sbGet<{ token: string }>(
    `push_tokens?empresa_id=eq.${empresaId}&legajo=in.(${legajos})&select=token`
  );
  if (!tokens.length) return 0;

  let app: ReturnType<typeof admin.app>;
  try {
    app = getFirebaseApp();
  } catch (e) {
    logger.error("[cron/push-ausencias] Firebase no configurado", e as Error);
    return 0;
  }

  const messaging = admin.messaging(app);
  const title = "Ausencias sin justificar";
  const body =
    totalAusentes === 1
      ? "1 empleado no fichó entrada hoy."
      : `${totalAusentes} empleados no ficharon entrada hoy.`;

  const tokensInvalidos: string[] = [];
  let enviados = 0;

  await Promise.allSettled(
    tokens.map(async (t) => {
      try {
        await messaging.send({
          token: t.token,
          notification: { title, body },
          data: { empresa_id: empresaId, fecha, tipo: "ausencia_no_justificada" },
          webpush: {
            notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" },
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

  // Limpiar tokens inválidos (fire-and-forget)
  if (tokensInvalidos.length) {
    const list = tokensInvalidos.map((tk) => `token=eq.${encodeURIComponent(tk)}`).join(",");
    fetch(`${SB_URL}/rest/v1/push_tokens?or=(${list})`, {
      method: "DELETE",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).catch(() => {});
  }

  return enviados;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!SB_URL || !SB_KEY) {
    return NextResponse.json({ error: "Config faltante" }, { status: 500 });
  }

  // Fecha argentina: UTC-3 (sin DST)
  const ahora = new Date();
  const ahoraAr = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
  const fecha = ahoraAr.toISOString().split("T")[0]; // YYYY-MM-DD
  const diaKey: DiaClave = DIAS_CLAVE[ahoraAr.getDay()];

  // Solo procesar días hábiles (el cron de vercel también tiene 1-5, pero doble check)
  if (diaKey === "dom" || diaKey === "sab") {
    return NextResponse.json({ ok: true, skipped: "fin_de_semana", fecha });
  }

  try {
    // Todos los empleados activos con diagrama que tienen turno hoy
    // Carga en lotes para no saturar memoria con empresas grandes
    const empleados = await sbGet<{
      id: string;
      empresa_id: string;
      legajo: number;
      diagrama: Record<string, unknown> | null;
    }>(`empleados?activo=eq.true&diagrama=not.is.null&select=id,empresa_id,legajo,diagrama&limit=2000`);

    // Filtrar los que tienen turno programado para hoy
    const conTurnoHoy = empleados.filter((e) => {
      const diag = e.diagrama as Record<string, unknown> | null;
      return diag && diag[diaKey] != null;
    });

    if (!conTurnoHoy.length) {
      return NextResponse.json({ ok: true, ausentes: 0, fecha });
    }

    // Agrupar por empresa para consultar fichadas de a una empresa
    const porEmpresa = new Map<string, typeof conTurnoHoy>();
    for (const e of conTurnoHoy) {
      const arr = porEmpresa.get(e.empresa_id) ?? [];
      arr.push(e);
      porEmpresa.set(e.empresa_id, arr);
    }

    let totalNotificaciones = 0;
    let totalAusentesProcesados = 0;

    for (const [empresaId, empList] of porEmpresa) {
      try {
        // Fichadas de hoy para esta empresa
        const fichadasHoy = await sbGet<{ empleado_id: string }>(
          `fichadas?empresa_id=eq.${empresaId}&fecha=eq.${fecha}&ingreso=not.is.null&select=empleado_id`
        );
        const fichados = new Set(fichadasHoy.map((f) => f.empleado_id));

        const ausentes = empList.filter((e) => !fichados.has(e.id));
        if (!ausentes.length) continue;

        totalAusentesProcesados += ausentes.length;
        const enviados = await enviarPushGerencia(empresaId, ausentes.length, fecha);
        totalNotificaciones += enviados;
        logger.info(
          `[cron/push-ausencias] empresa=${empresaId} ausentes=${ausentes.length} pushEnviados=${enviados}`
        );
      } catch (e) {
        logger.error(`[cron/push-ausencias] Error empresa=${empresaId}`, e as Error);
      }
    }

    return NextResponse.json({
      ok: true,
      fecha,
      diaKey,
      ausentes: totalAusentesProcesados,
      notificaciones_enviadas: totalNotificaciones,
    });
  } catch (e) {
    logger.error("[cron/push-ausencias] Error fatal", e as Error);
    return NextResponse.json({ error: "Error interno del cron" }, { status: 500 });
  }
}
