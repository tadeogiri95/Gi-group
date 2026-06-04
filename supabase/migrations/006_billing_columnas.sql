-- ═══════════════════════════════════════════════════════════════════════════
-- 006_billing_columnas.sql — Columnas agregadas por Bloque 3 (Billing)
--
-- ⚠️ NO EJECUTAR. Documentación del estado actual.
-- Estas columnas ya existen en producción. Se documentan acá porque
-- los archivos 001-005 se generaron antes de Bloque 3.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── empresa: referencia a la suscripción activa ───
ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS suscripcion_activa_id bigint
    REFERENCES suscripciones(id) ON DELETE SET NULL;
-- Usado en: /api/billing/webhook (al activar/cancelar suscripción)


-- ─── suscripciones: ID del preapproval en Mercado Pago ───
ALTER TABLE suscripciones
  ADD COLUMN IF NOT EXISTS gateway_subscription_id text;
-- Usado en: /api/billing/create-subscription (guarda mp.id),
--           /api/billing/portal (para cancelar en MP),
--           /api/billing/webhook (para buscar suscripción local por MP id)
-- NOTA: gateway_id en 001 era un placeholder genérico — gateway_subscription_id
--       es el nombre real usado en el código.


-- ─── pagos: fecha efectiva del pago ───
ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS fecha_pago timestamptz;
-- Usado en: /api/billing/webhook (date_approved || date_created de MP)
-- Diferente de created_at: fecha_pago es cuándo MP procesó el cobro,
-- created_at es cuándo nuestro webhook lo registró.
