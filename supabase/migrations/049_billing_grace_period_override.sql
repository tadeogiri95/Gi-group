-- 049: Grace period para downgrades + protección de override manual de plan
--
-- plan_vence: cuando una suscripción se cancela, el plan sigue activo hasta
-- esta fecha (= periodo_fin de la suscripción). Después se degrada a free.
--
-- plan_override_manual: true cuando el superadmin cambió el plan a mano.
-- El webhook no pisa plan_activo si este flag está activo.

ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS plan_vence timestamptz,
  ADD COLUMN IF NOT EXISTS plan_override_manual boolean NOT NULL DEFAULT false;

-- Índice para el cron que barre grace periods vencidos
CREATE INDEX IF NOT EXISTS idx_empresa_plan_vence
  ON empresa (plan_vence)
  WHERE plan_vence IS NOT NULL;
