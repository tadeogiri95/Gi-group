-- ═══════════════════════════════════════════════════════════════════════════
-- 012_email_verificado.sql — Verificación de email en registro de empresa
--
-- DEFAULT true para no afectar empresas existentes (ya verificadas por defecto).
-- Las empresas nuevas reciben email_verificado = false al registrarse.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS email_verificado boolean DEFAULT true;

ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS email_verify_token text;

-- Índice para lookup rápido del token en /api/verificar-email
CREATE INDEX IF NOT EXISTS idx_empresa_verify_token
  ON empresa (email_verify_token)
  WHERE email_verify_token IS NOT NULL;
