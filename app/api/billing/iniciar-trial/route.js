// ═══════════════════════════════════════════════════════════
// POST /api/billing/iniciar-trial — Botón "Probar Pro gratis 14 días"
//
// Las empresas nuevas arrancan en plan Free (ver migración 063). Este
// endpoint es el único disparador de la prueba de Pro: el admin decide
// cuándo, no se activa sola al registrarse.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { sbGet } from "../../../lib/sbHelpers";
import { iniciarTrialEmpresa } from "../../../lib/empresaSignup";
import { invalidarCachePlan } from "../../../lib/planEnforcement";
import { logger } from "../../../lib/logger";
import { safeErrorMessage } from "../../../lib/validate";

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!["gerencial", "administrativo"].includes(sesion.rol)) {
      return NextResponse.json({ error: "Solo el administrador puede iniciar la prueba gratuita" }, { status: 403 });
    }

    const rows = await sbGet(`empresa?id=eq.${sesion.empresa_id}&select=plan_activo,trial_usado&limit=1`);
    const empresa = rows?.[0];
    if (!empresa) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

    if (empresa.trial_usado) {
      return NextResponse.json({ error: "Ya usaste tu prueba gratuita de Pro" }, { status: 409 });
    }
    if (empresa.plan_activo !== "free") {
      return NextResponse.json({ error: "Ya tenés un plan activo distinto de Free" }, { status: 409 });
    }

    const ok = await iniciarTrialEmpresa(sesion.empresa_id);
    if (!ok) {
      return NextResponse.json({ error: "No se pudo iniciar la prueba. Intentá de nuevo en unos minutos." }, { status: 500 });
    }

    invalidarCachePlan(sesion.empresa_id);

    return NextResponse.json({ ok: true, plan: "trial", dias: 14 });
  } catch (err) {
    logger.error("[billing/iniciar-trial] Error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
