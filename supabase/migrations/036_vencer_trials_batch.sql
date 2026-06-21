-- ═══════════════════════════════════════════════════════════════════════════
-- 036_vencer_trials_batch.sql — RPC batch para vencer TODOS los trials
-- expirados en una sola transacción (reemplaza el loop N+1 del cron
-- /api/cron/vencer-trials, que llamaba a vencer_trial_atomico() una vez
-- por cada suscripción vencida).
--
-- Usa CTEs encadenadas: primero marca las suscripciones vencidas y
-- devuelve qué empresas afectó, después actualiza esas empresas, y
-- finalmente devuelve los datos necesarios para mandar el email de aviso
-- (evita un round-trip extra para traer "empresa" después).
--
-- Idempotente: los WHERE filtran por estado actual, igual que 019.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION vencer_trials_batch()
RETURNS TABLE (
  empresa_id   uuid,
  nombre       text,
  nombre_corto text,
  slug         text,
  admin_email  text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH vencidas AS (
    UPDATE suscripciones
      SET estado = 'vencida'
      WHERE estado = 'trial' AND trial_fin < now()
      RETURNING suscripciones.empresa_id
  ),
  empresas_afectadas AS (
    UPDATE empresa
      SET plan_activo = 'free',
          suscripcion_activa_id = NULL
      WHERE empresa.id IN (SELECT v.empresa_id FROM vencidas v)
        AND empresa.plan_activo = 'trial'
      RETURNING empresa.id, empresa.nombre, empresa.nombre_corto, empresa.slug, empresa.admin_email
  )
  SELECT DISTINCT e.id, e.nombre, e.nombre_corto, e.slug, e.admin_email
  FROM empresas_afectadas e;
END;
$$;
