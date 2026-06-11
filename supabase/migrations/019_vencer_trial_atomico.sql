-- ═══════════════════════════════════════════════════════════════════════════
-- 019_vencer_trial_atomico.sql — RPC para downgrade de trial en una sola TX
--
-- Reemplaza los dos PATCHes secuenciales del cron /api/cron/vencer-trials.
-- Al ejecutarse dentro de una transacción PostgreSQL, si cualquiera de los
-- dos UPDATEs falla toda la operación se revierte → el cron puede reintentar
-- en la próxima ejecución sin dejar estado inconsistente.
--
-- Idempotente: los WHERE filtran por estado actual, así que ejecutar dos
-- veces sobre la misma suscripción no tiene efectos secundarios.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION vencer_trial_atomico(
  p_suscripcion_id bigint,
  p_empresa_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE suscripciones
    SET estado = 'vencida'
    WHERE id = p_suscripcion_id
      AND estado = 'trial';

  UPDATE empresa
    SET plan_activo          = 'free',
        suscripcion_activa_id = NULL
    WHERE id = p_empresa_id
      AND plan_activo = 'trial';
END;
$$;
