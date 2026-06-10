-- 014_trial_vencer_index.sql
-- Índice para el cron /api/cron/vencer-trials — query rápida sobre trials expirados.

CREATE INDEX IF NOT EXISTS idx_suscripciones_trial_vencer
  ON suscripciones (trial_fin)
  WHERE estado = 'trial';
