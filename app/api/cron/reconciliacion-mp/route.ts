// GET /api/cron/reconciliacion-mp
// Corre diariamente (vercel.json). Compara el estado local de `suscripciones`
// (activa | suspendida, gateway mercadopago) contra el estado real en Mercado
// Pago, para detectar casos donde un webhook falló silenciosamente y nunca
// se reintentó.
//
// MODO DRY-RUN: solo loggea y manda un email de alerta con las discrepancias
// encontradas. No corrige ningún estado automáticamente — la corrección queda
// para una revisión manual hasta validar este cron en producción.
import { NextRequest, NextResponse } from "next/server";
import { getPreapproval } from "../../../lib/mercadopago";
import { sendReconciliacionAlerta } from "../../../lib/email";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Tope defensivo por corrida — evita que el cron exceda el timeout de la
// función serverless si la base de suscripciones activas crece mucho.
const MAX_POR_CORRIDA = 300;

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`sbGet ${path}: ${await r.text()}`);
  return r.json();
}

// Mismo mapeo status MP → estado local que usa el webhook (billing/webhook/route.js)
function estadoSegunMp(status: string): string {
  if (status === "authorized") return "activa";
  if (status === "paused") return "suspendida";
  if (status === "cancelled") return "cancelada";
  if (status === "pending") return "suspendida";
  return "desconocido";
}

interface SuscripcionRow {
  id: number;
  empresa_id: string;
  estado: string;
  plan: string;
  gateway_subscription_id: string;
}

interface Discrepancia {
  suscripcion_id: number;
  empresa_id: string;
  plan: string;
  estado_local: string;
  estado_mp: string;
  mp_status_raw: string;
  gateway_subscription_id: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const subs: SuscripcionRow[] = await sbGet(
      `suscripciones?estado=in.(activa,suspendida)&gateway=eq.mercadopago&gateway_subscription_id=not.is.null` +
      `&order=created_at.asc&limit=${MAX_POR_CORRIDA}&select=id,empresa_id,estado,plan,gateway_subscription_id`
    );

    if (!subs || subs.length === 0) {
      return NextResponse.json({ ok: true, revisadas: 0, discrepancias: [] });
    }

    const discrepancias: Discrepancia[] = [];
    let errores = 0;

    // Secuencial (no Promise.all): evita ráfagas que puedan disparar
    // rate-limiting de la API de Mercado Pago. El volumen esperado (PyMEs)
    // es chico; si esto crece, paginar/paralelizar en lotes.
    for (const s of subs) {
      try {
        const mp = await getPreapproval(s.gateway_subscription_id);
        const estadoMp = estadoSegunMp(mp.status);
        if (estadoMp !== s.estado) {
          discrepancias.push({
            suscripcion_id: s.id,
            empresa_id: s.empresa_id,
            plan: s.plan,
            estado_local: s.estado,
            estado_mp: estadoMp,
            mp_status_raw: mp.status,
            gateway_subscription_id: s.gateway_subscription_id,
          });
        }
      } catch (e) {
        errores++;
        logger.error(
          `[reconciliacion-mp] Error consultando preapproval ${s.gateway_subscription_id}`,
          e,
          { suscripcion_id: s.id }
        );
      }
    }

    if (discrepancias.length > 0) {
      logger.error(
        `[reconciliacion-mp] ${discrepancias.length} discrepancia(s) entre estado local y Mercado Pago`,
        new Error("reconciliacion_discrepancia"),
        { discrepancias }
      );
      sendReconciliacionAlerta({ discrepancias }).catch(() => {});
    }

    logger.debug(
      `[reconciliacion-mp] Revisadas: ${subs.length}, discrepancias: ${discrepancias.length}, errores: ${errores}`
    );
    return NextResponse.json({ ok: true, revisadas: subs.length, discrepancias, errores });
  } catch (e) {
    logger.error("[reconciliacion-mp] Error fatal — cron abortado", e as Error);
    return NextResponse.json({ error: "Error interno del cron", detail: (e as Error).message }, { status: 500 });
  }
}
