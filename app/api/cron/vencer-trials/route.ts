// GET /api/cron/vencer-trials
// Corre diariamente (vercel.json). Busca trials expirados y los pasa a free.
// Envía email de notificación al admin de cada empresa afectada.
import { NextRequest, NextResponse } from "next/server";
import { sendTrialExpirado } from "../../../lib/email";
import { logger } from "../../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`sbGet ${path}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sbPatch ${path}: ${await r.text()}`);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
  const now = new Date().toISOString();

  // Trials cuyo período ya expiró y todavía no fueron procesados
  const trialsVencidos: { id: number; empresa_id: string }[] = await sbGet(
    `suscripciones?estado=eq.trial&trial_fin=lt.${now}&select=id,empresa_id`
  );

  if (!trialsVencidos || trialsVencidos.length === 0) {
    return NextResponse.json({ ok: true, vencidos: 0 });
  }

  const empresaIds = [...new Set(trialsVencidos.map((s) => s.empresa_id))];

  // Obtener datos de empresas para enviar emails
  const empresas: { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string }[] =
    await sbGet(`empresa?id=in.(${empresaIds.join(",")})&select=id,nombre,nombre_corto,slug,admin_email`);

  const empMap = Object.fromEntries(empresas.map((e) => [e.id, e]));

  let procesados = 0;
  let errores = 0;

  for (const { id: suscId, empresa_id } of trialsVencidos) {
    try {
      // Downgrade atómico vía RPC (migración 019).
      // Ambos UPDATEs corren en la misma transacción PostgreSQL: si uno falla
      // se revierten los dos y el cron puede reintentar en la próxima ejecución.
      const rpcRes = await fetch(`${SB_URL}/rest/v1/rpc/vencer_trial_atomico`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_suscripcion_id: suscId, p_empresa_id: empresa_id }),
        signal: AbortSignal.timeout(10000),
      });

      if (!rpcRes.ok) {
        const errText = await rpcRes.text();
        // Si la migración 019 aún no se aplicó, caer al orden seguro: empresa primero.
        // Actualizar empresa primero garantiza que si el segundo PATCH falla, el próximo
        // cron run encontrará plan_activo='trial' y reintentará (idempotente).
        if (errText.includes("vencer_trial_atomico") || rpcRes.status === 404) {
          logger.error(`RPC vencer_trial_atomico no disponible — usando fallback secuencial`, new Error(errText));
          await sbPatch(`empresa?id=eq.${empresa_id}`, {
            plan_activo: "free",
            suscripcion_activa_id: null,
          });
          await sbPatch(`suscripciones?id=eq.${suscId}`, { estado: "vencida" });
        } else {
          throw new Error(`RPC vencer_trial_atomico status ${rpcRes.status}: ${errText}`);
        }
      }

      // Notificar al admin (fire-and-forget)
      const emp = empMap[empresa_id];
      if (emp?.admin_email) {
        sendTrialExpirado({
          to: emp.admin_email,
          nombre: emp.nombre_corto || emp.nombre,
          empresa: emp.nombre_corto || emp.nombre,
          slug: emp.slug,
        });
      }

      procesados++;
    } catch (e) {
      logger.error(`Error venciendo trial suscId=${suscId}`, e, { empresa_id });
      errores++;
    }
  }

  logger.debug(`[vencer-trials] Procesados: ${procesados}, Errores: ${errores}`);
  return NextResponse.json({ ok: true, vencidos: procesados, errores });

  } catch (e) {
    logger.error("[vencer-trials] Error fatal — cron abortado", e as Error);
    return NextResponse.json({ error: "Error interno del cron", detail: (e as Error).message }, { status: 500 });
  }
}
