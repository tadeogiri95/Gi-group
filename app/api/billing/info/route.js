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
    const empRows = await sbGet(
      `empresa?id=eq.${sesion.empresa_id}&select=plan_activo&limit=1`,
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

    // Si hay trial_fin en la empresa y no hay suscripción activa, calcular estado del trial
    if (!sub && empresa?.trial_fin) {
      const ahora = new Date();
      const fin = new Date(empresa.trial_fin);
      estado = fin > ahora ? "trial" : "vencida";
    }

    // Si la suscripción dice "trial", verificar que no haya vencido
    if (estado === "trial") {
      const trialFinStr = sub?.trial_fin || empresa?.trial_fin;
      if (trialFinStr) {
        const fin = new Date(trialFinStr);
        if (fin <= new Date()) {
          estado = "vencida";
        }
      }
    }

    // ── Calcular días restantes del trial ──
    let dias_restantes = null;
    if (estado === "trial") {
      const trialFinStr = sub?.trial_fin || empresa?.trial_fin;
      if (trialFinStr) {
        const ahora = new Date();
        const fin = new Date(trialFinStr);
        dias_restantes = Math.max(0, Math.ceil((fin - ahora) / (1000 * 60 * 60 * 24)));
      }
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
