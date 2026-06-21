-- ════════════════════════════════════════════════════════════════════
-- 043_columnas_fantasma_empresa.sql
-- Columnas que el código usa pero ninguna migración creó.
-- Existen en prod por DDL manual — esto las documenta formalmente.
-- ════════════════════════════════════════════════════════════════════

-- empresa: prompt_ia_chat (usado en empresa/route.js, AuthContext, schemas.ts)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS prompt_ia_chat text;

-- empresa: email_verify_expires (referenciado en CAMPOS_EXCLUIDOS de data/route.js)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS email_verify_expires timestamptz;

-- suscripciones: gateway_customer_id (escrita por billing/webhook.js)
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS gateway_customer_id text;
