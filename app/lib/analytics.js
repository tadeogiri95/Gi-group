// Fire-and-forget server-side event tracking.
// Never awaited in request handlers — failures are swallowed silently.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export function logEvent(evento, { empresa_id = null, empleado_id = null, plan = null, meta = {} } = {}) {
  if (!SB_URL || !SB_KEY) return;
  fetch(`${SB_URL}/rest/v1/metricas_eventos`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ evento, empresa_id, empleado_id, plan, meta }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// Standard event names — use these constants to avoid typos
export const EVT = {
  REGISTRO:            "registro",
  ONBOARDING_STEP:     "onboarding_step",
  ONBOARDING_COMPLETE: "onboarding_complete",
  ONBOARDING_SKIP:     "onboarding_skip",
  LOGIN:               "login",
  PRIMER_INVITE:       "primer_invite",
  PRIMER_FICHAJE:      "primer_fichaje",
  FICHAJE:             "fichaje",
  UPGRADE_INIT:        "upgrade_init",
  UPGRADE_COMPLETE:    "upgrade_complete",
  CHURN:               "churn",
  TRIAL_EXPIRED:       "trial_expired",
  PAGO_APROBADO:       "pago_aprobado",
  PAGO_RECHAZADO:      "pago_rechazado",
  REENGAGEMENT_ONBOARDING: "reengagement_onboarding",
  CONSULTA_ENTERPRISE: "consulta_enterprise",
};
