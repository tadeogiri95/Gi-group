// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/limpiar-tokens — Limpieza semanal de datos temporales acumulados
//
// Purga:
//   1. push_tokens sin actividad > 60 días
//   2. login_attempts > 2 horas  (evita crecimiento indefinido — A-04)
//   3. rate_limits > 2 horas     (evita crecimiento indefinido — A-04)
//   4. sesiones expiradas        (JTI blacklist con TTL implícito — B-04)
//   5. push_tokens huérfanos     (sin empleado activo dueño — ver migración 053)
//   6. audit_log > 180 días      (sin TTL previo, crece con cada fichaje/alta/impersonación)
//   7. geo_registros > 90 días   (pings de ubicación de fichadas ya resueltas)
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { logger } from "../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Config faltante" }, { status: 500 });
  }

  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "return=representation" };
  const headersNoReturn = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const now = new Date();

  const resultados = {};

  try {
    // 1. Push tokens sin actividad > 60 días
    const cortePush = new Date(now);
    cortePush.setDate(cortePush.getDate() - 60);
    const resPush = await fetch(
      `${SUPABASE_URL}/rest/v1/push_tokens?updated_at=lt.${cortePush.toISOString()}`,
      { method: "DELETE", headers }
    );
    const deletedPush = resPush.ok ? await resPush.json() : [];
    resultados.push_tokens_eliminados = Array.isArray(deletedPush) ? deletedPush.length : 0;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando push_tokens", e);
    resultados.push_tokens_error = e.message;
  }

  try {
    // 2. Login attempts > 2 horas
    // ventana tiene formato 'YYYY-MM-DDTHH:MM' — comparar como string es correcto
    // porque el formato es lexicográficamente ordenable
    const corteAttempts = new Date(now);
    corteAttempts.setHours(corteAttempts.getHours() - 2);
    const ventanaCorte = corteAttempts.toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
    await fetch(
      `${SUPABASE_URL}/rest/v1/login_attempts?ventana=lt.${ventanaCorte}`,
      { method: "DELETE", headers: headersNoReturn }
    );
    resultados.login_attempts_limpiados = true;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando login_attempts", e);
    resultados.login_attempts_error = e.message;
  }

  try {
    // 3. Rate limits de chat IA > 2 horas
    const corteRateLimits = new Date(now);
    corteRateLimits.setHours(corteRateLimits.getHours() - 2);
    await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limits?created_at=lt.${corteRateLimits.toISOString()}`,
      { method: "DELETE", headers: headersNoReturn }
    );
    resultados.rate_limits_limpiados = true;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando rate_limits", e);
    resultados.rate_limits_error = e.message;
  }

  try {
    // 4. Sesiones JWT expiradas — limpia el JTI blacklist implícito
    await fetch(
      `${SUPABASE_URL}/rest/v1/sesiones?expira_en=lt.${now.toISOString()}`,
      { method: "DELETE", headers: headersNoReturn }
    );
    resultados.sesiones_expiradas_limpiadas = true;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando sesiones expiradas", e);
    resultados.sesiones_error = e.message;
  }

  try {
    // 5. push_tokens huérfanos — push_tokens no tiene FK real a empleados
    // (se relaciona por empresa_id+legajo), así que un empleado borrado o
    // desactivado deja sus tokens sin dueño. Ver migración 053.
    const resOrf = await fetch(`${SUPABASE_URL}/rest/v1/rpc/limpiar_push_tokens_huerfanos`, {
      method: "POST",
      headers: headersNoReturn,
    });
    resultados.push_tokens_huerfanos_eliminados = resOrf.ok ? await resOrf.json() : null;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando push_tokens huérfanos", e);
    resultados.push_tokens_huerfanos_error = e.message;
  }

  try {
    // 6. audit_log > 180 días — la tabla no tiene TTL y crece con cada fichaje,
    // alta, cambio de plan o impersonación (actor_id no tiene FK a propósito:
    // el log debe sobrevivir aunque se borre el actor). 180 días da margen para
    // cualquier investigación de seguridad o disputa sin crecer sin límite.
    const corteAudit = new Date(now);
    corteAudit.setDate(corteAudit.getDate() - 180);
    await fetch(
      `${SUPABASE_URL}/rest/v1/audit_log?created_at=lt.${corteAudit.toISOString()}`,
      { method: "DELETE", headers: headersNoReturn }
    );
    resultados.audit_log_limpiado = true;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando audit_log", e);
    resultados.audit_log_error = e.message;
  }

  try {
    // 7. geo_registros > 90 días — son pings de ubicación atados a fichadas
    // que ya quedaron resueltas (con horas/tardanza calculadas); no necesitan
    // retenerse tanto como audit_log.
    const corteGeo = new Date(now);
    corteGeo.setDate(corteGeo.getDate() - 90);
    await fetch(
      `${SUPABASE_URL}/rest/v1/geo_registros?created_at=lt.${corteGeo.toISOString()}`,
      { method: "DELETE", headers: headersNoReturn }
    );
    resultados.geo_registros_limpiados = true;
  } catch (e) {
    logger.error("[limpiar-tokens] Error eliminando geo_registros", e);
    resultados.geo_registros_error = e.message;
  }

  logger.debug("[limpiar-tokens] Completado", resultados);
  return NextResponse.json({ ok: true, ...resultados });
}
