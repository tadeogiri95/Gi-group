// ═══════════════════════════════════════════════════════════
// POST /api/billing/iniciar-trial — "Activá tu prueba gratuita" (30 días)
//
// Desde la migración 080 la prueba arranca sola al registrarse (D20). Este
// botón queda para la empresa a la que eso le falló: sigue en 'free' sin
// haber usado la prueba.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { iniciarTrialEmpresa } from "../../../lib/empresaSignup";
import { invalidarCachePlan } from "../../../lib/planEnforcement";
import { DIAS_TRIAL } from "../../../lib/plans";
import { logger } from "../../../lib/logger";
import { safeErrorMessage } from "../../../lib/validate";

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (sesion.rol !== "gerencial") {
      return NextResponse.json({ error: "Solo el dueño de la cuenta puede iniciar la prueba gratuita" }, { status: 403 });
    }

    const rows = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=plan_activo,trial_usado&limit=1`);
    const empresa = rows?.[0];
    if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    if (empresa.trial_usado) {
      return NextResponse.json({ error: "Ya usaste tu prueba gratuita" }, { status: 409 });
    }
    if (empresa.plan_activo !== "free") {
      return NextResponse.json({ error: "Ya tenés un plan activo" }, { status: 409 });
    }

    const ok = await iniciarTrialEmpresa(sesion.empresa_id);
    if (!ok) {
      return NextResponse.json({ error: "No se pudo iniciar la prueba. Intentá de nuevo en unos minutos." }, { status: 500 });
    }

    invalidarCachePlan(sesion.empresa_id);

    return NextResponse.json({ ok: true, plan: "trial", dias: DIAS_TRIAL });
  } catch (err) {
    logger.error("[billing/iniciar-trial] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
