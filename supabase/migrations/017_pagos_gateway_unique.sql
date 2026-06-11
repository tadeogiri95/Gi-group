-- ═══════════════════════════════════════════════════════════════════════════
-- 017_pagos_gateway_unique.sql — UNIQUE en pagos.gateway_payment_id
--
-- Garantiza idempotencia del webhook de Mercado Pago: si MP reintenta
-- el mismo evento, el INSERT falla en lugar de crear un registro duplicado.
--
-- El código de /api/billing/webhook ya hace el check antes de insertar,
-- este constraint es la segunda línea de defensa (nivel base de datos).
--
-- SAFE: PostgreSQL UNIQUE permite múltiples NULLs, por lo que los pagos
-- sin gateway_payment_id (errores de parseo, eventos sin ID) no se ven
-- afectados.
--
-- PREREQUISITO: verificar que no existen filas duplicadas antes de aplicar:
--   SELECT gateway_payment_id, COUNT(*)
--   FROM pagos
--   WHERE gateway_payment_id IS NOT NULL
--   GROUP BY gateway_payment_id
--   HAVING COUNT(*) > 1;
-- Si la query no devuelve filas, es seguro aplicar esta migración.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE pagos
  ADD CONSTRAINT pagos_gateway_payment_id_unique
  UNIQUE (gateway_payment_id);
