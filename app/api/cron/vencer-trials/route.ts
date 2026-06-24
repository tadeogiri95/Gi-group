// GET /api/cron/vencer-trials
// Corre diariamente (vercel.json). Busca trials expirados y los pasa a free.
// Envía email de notificación al admin de cada empresa afectada.
import { NextRequest, NextResponse } from "next/server";
import { sendTrialExpirado } from "../../../lib/email";
import { logger } from "../../../lib/logger";
import { logEvent, EVT } from "../../../lib/analytics";

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

type EmpresaAfectada = { empresa_id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string };

const CATORCE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Huérfanas: empresas con plan no-free y CERO filas en `suscripciones`
// — caso de doble falla en registro-empresa (RPC iniciar_trial_pro + INSERT
// de fallback fallaron los dos), invisible para el resto de este cron
// porque arranca siempre desde `suscripciones`. Se exige más de 14 días de
// antigüedad (mismo plazo que un trial normal) y se excluyen las empresas
// con plan_override_manual=true: son planes pactados a mano por el
// superadmin (p.ej. enterprise) que a propósito no tienen fila en
// suscripciones — bajarlas a free sería un downgrade indebido.
// ───
async function corregirEmpresasHuerfanas(): Promise<EmpresaAfectada[]> {
  const cutoff = new Date(Date.now() - CATORCE_DIAS_MS).toISOString();

  const candidatas: { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string }[] =
    await sbGet(
      `empresa?plan_activo=neq.free&plan_override_manual=eq.false&created_at=lt.${cutoff}&select=id,nombre,nombre_corto,slug,admin_email`
    );

  if (!candidatas || candidatas.length === 0) return [];

  const ids = candidatas.map((c) => c.id);
  const conSuscripcion: { empresa_id: string }[] = await sbGet(
    `suscripciones?empresa_id=in.(${ids.join(",")})&select=empresa_id`
  );
  const idsConSuscripcion = new Set((conSuscripcion || []).map((s) => s.empresa_id));

  const huerfanas = candidatas.filter((c) => !idsConSuscripcion.has(c.id));

  for (const h of huerfanas) {
    await sbPatch(`empresa?id=eq.${h.id}`, { plan_activo: "free", suscripcion_activa_id: null });
    logger.error(
      "[TRIAL_DOBLE_FALLA] empresa sin ninguna fila en suscripciones, corregida a free por el cron de huérfanas",
      undefined,
      { empresa_id: h.id }
    );
  }

  return huerfanas.map((h) => ({
    empresa_id: h.id,
    nombre: h.nombre,
    nombre_corto: h.nombre_corto,
    slug: h.slug,
    admin_email: h.admin_email,
  }));
}

// ─── Notifica por email + analytics, igual que a un trial vencido normal ───
async function notificarVencimiento(afectadas: EmpresaAfectada[]): Promise<number> {
  let enviados = 0;
  for (const e of afectadas) {
    logEvent(EVT.TRIAL_EXPIRED, { empresa_id: e.empresa_id });
    if (e.admin_email) {
      sendTrialExpirado({
        to: e.admin_email,
        nombre: e.nombre_corto || e.nombre,
        empresa: e.nombre_corto || e.nombre,
        slug: e.slug,
        empresaId: e.empresa_id,
      });
      enviados++;
    }
  }
  return enviados;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
  const now = new Date().toISOString();

  // Huérfanas no dependen de `suscripciones`, así que se corrigen aparte y
  // se suman al conteo de "vencidos" del flujo que corresponda más abajo.
  const huerfanas = await corregirEmpresasHuerfanas();

  // ─── Intento 1: RPC batch (migración 036) — una sola transacción para
  // TODOS los trials vencidos, sin loop por fila. ───
  let afectadas: EmpresaAfectada[] | null = null;

  const batchRes = await fetch(`${SB_URL}/rest/v1/rpc/vencer_trials_batch`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });

  if (batchRes.ok) {
    afectadas = await batchRes.json();
  } else {
    const errText = await batchRes.text();
    if (!(errText.includes("vencer_trials_batch") || batchRes.status === 404)) {
      throw new Error(`RPC vencer_trials_batch status ${batchRes.status}: ${errText}`);
    }
    logger.error("RPC vencer_trials_batch no disponible (migración 036 pendiente) — usando fallback fila por fila", new Error(errText));
  }

  if (afectadas) {
    const todas = [...afectadas, ...huerfanas];
    const enviados = await notificarVencimiento(todas);
    logger.debug(`[vencer-trials] Procesados (batch): ${todas.length}, emails: ${enviados}`);
    return NextResponse.json({ ok: true, vencidos: todas.length });
  }

  // ─── Fallback: comportamiento anterior fila por fila (migración 036 no aplicada) ───
  const trialsVencidos: { id: number; empresa_id: string }[] = await sbGet(
    `suscripciones?estado=eq.trial&trial_fin=lt.${now}&select=id,empresa_id`
  );

  if (!trialsVencidos || trialsVencidos.length === 0) {
    if (huerfanas.length === 0) {
      return NextResponse.json({ ok: true, vencidos: 0 });
    }
    await notificarVencimiento(huerfanas);
    logger.debug(`[vencer-trials] Procesados (solo huerfanas): ${huerfanas.length}`);
    return NextResponse.json({ ok: true, vencidos: huerfanas.length });
  }

  const empresaIds = [...new Set(trialsVencidos.map((s) => s.empresa_id))];

  const empresas: { id: string; nombre: string; nombre_corto: string; slug: string; admin_email: string }[] =
    await sbGet(`empresa?id=in.(${empresaIds.join(",")})&select=id,nombre,nombre_corto,slug,admin_email`);

  const empMap = Object.fromEntries(empresas.map((e) => [e.id, e]));

  let procesados = 0;
  let errores = 0;

  for (const { id: suscId, empresa_id } of trialsVencidos) {
    try {
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

      const emp = empMap[empresa_id];
      if (emp?.admin_email) {
        sendTrialExpirado({
          to: emp.admin_email,
          nombre: emp.nombre_corto || emp.nombre,
          empresa: emp.nombre_corto || emp.nombre,
          slug: emp.slug,
          empresaId: empresa_id,
        });
      }

      procesados++;
    } catch (e) {
      logger.error(`Error venciendo trial suscId=${suscId}`, e, { empresa_id });
      errores++;
    }
  }

  await notificarVencimiento(huerfanas);

  logger.debug(`[vencer-trials] Procesados: ${procesados}, Errores: ${errores}, Huerfanas: ${huerfanas.length}`);
  return NextResponse.json({ ok: true, vencidos: procesados + huerfanas.length, errores });

  } catch (e) {
    logger.error("[vencer-trials] Error fatal — cron abortado", e as Error);
    return NextResponse.json({ error: "Error interno del cron", detail: (e as Error).message }, { status: 500 });
  }
}
