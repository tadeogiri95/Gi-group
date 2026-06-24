// ═══════════════════════════════════════════════════════════
// GET /api/billing/info — Info de plan, trial y suscripción
//
// Campos devueltos:
//   plan           (string)       id del plan activo
//   estado         (string)       "trial"|"activa"|"vencida"|"suspendida"|"cancelada"
//   dias_restantes (number|null)  días restantes del trial, null si no aplica
//   periodo_fin    (string|null)  ISO date del fin del período pago
//   precio         (number)       precio mensual del plan
//   moneda         (string)       "ARS"
//   gateway        (string|null)  "mercadopago" | null
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { PLANES } from "../../../lib/plans";
import { logger } from "../../../lib/logger";

const CATORCE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();

    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json(
        { error: "Solo el administrador puede ver la información de facturación" },
        { status: 403 }
      );
    }

    // ── Leer datos de la empresa (plan_activo) ──
    // NOTA: trial_fin vive en `suscripciones`, no en `empresa` — pedirlo acá
    // hacía que PostgREST rechazara la query completa (columna inexistente),
    // dejando `empresa` siempre en null y el fallback de abajo siempre muerto.
    // created_at se usa como fallback síntetico (ver más abajo).
    const empRows = await sbGet(
      `empresa?id=eq.${sesion.empresa_id}&select=plan_activo,created_at&limit=1`,
      { silent: true }
    );
    const empresa = empRows?.[0] ?? null;

    // ── Leer la suscripción más reciente ──
    const suscRows = await sbGet(
      `suscripciones?empresa_id=eq.${sesion.empresa_id}&order=created_at.desc&limit=1`,
      { silent: true, fallback: [] }
    );
    const sub = Array.isArray(suscRows) ? suscRows[0] ?? null : null;

    // ── Determinar plan y estado ──
    const planId = sub?.plan || empresa?.plan_activo || "free";
    const planInfo = PLANES[planId] || PLANES.free;

    let estado = sub?.estado ?? "activa";
    let trialFinStr = sub?.trial_fin ?? null;

    // Empresa marcada como trial sin ninguna fila en `suscripciones`: el RPC
    // iniciar_trial_pro y su fallback de INSERT fallaron los dos durante el
    // registro. En vez de dejarla "activa" para siempre (revenue leak),
    // reconstruimos un trial_fin sintético desde created_at + 14 días. Sin
    // created_at, o ya vencido, se trata como "vencida" — nunca como acceso
    // gratuito indefinido.
    if (!sub && empresa?.plan_activo === "trial") {
      if (empresa.created_at) {
        const sintetico = new Date(new Date(empresa.created_at).getTime() + CATORCE_DIAS_MS);
        trialFinStr = sintetico.toISOString();
        estado = sintetico > new Date() ? "trial" : "vencida";
      } else {
        estado = "vencida";
      }
    }

    // Si el estado es "trial" (de la suscripción o sintético), verificar que no haya vencido
    if (estado === "trial" && trialFinStr) {
      const fin = new Date(trialFinStr);
      if (fin <= new Date()) {
        estado = "vencida";
      }
    }

    // ── Calcular días restantes del trial ──
    let dias_restantes = null;
    if (estado === "trial" && trialFinStr) {
      const ahora = new Date();
      const fin = new Date(trialFinStr);
      dias_restantes = Math.max(0, Math.ceil((fin - ahora) / (1000 * 60 * 60 * 24)));
    }

    // ── Precio: usar el de la suscripción si existe, si no el del plan ──
    const precio = sub?.precio ?? planInfo.precio ?? 0;
    const moneda = sub?.moneda ?? planInfo.moneda ?? "ARS";
    const gateway = sub?.gateway ?? null;
    const periodo_fin = sub?.periodo_fin ?? null;

    return NextResponse.json({
      plan: planId,
      estado,
      dias_restantes,
      periodo_fin,
      precio,
      moneda,
      gateway,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    logger.error("GET /api/billing/info", err);
    return NextResponse.json({ error: "Error interno al obtener info de facturación" }, { status: 500 });
  }
}
