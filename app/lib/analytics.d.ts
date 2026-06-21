export function logEvent(
  evento: string,
  opts?: {
    empresa_id?: string | null;
    empleado_id?: string | null;
    plan?: string | null;
    meta?: Record<string, unknown>;
  }
): void;

export const EVT: {
  REGISTRO: string;
  ONBOARDING_STEP: string;
  ONBOARDING_COMPLETE: string;
  ONBOARDING_SKIP: string;
  LOGIN: string;
  PRIMER_INVITE: string;
  PRIMER_FICHAJE: string;
  FICHAJE: string;
  UPGRADE_INIT: string;
  UPGRADE_COMPLETE: string;
  CHURN: string;
  TRIAL_EXPIRED: string;
  PAGO_APROBADO: string;
  PAGO_RECHAZADO: string;
  REENGAGEMENT_ONBOARDING: string;
  CONSULTA_ENTERPRISE: string;
};
