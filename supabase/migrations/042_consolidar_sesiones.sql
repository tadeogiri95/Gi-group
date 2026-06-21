-- ════════════════════════════════════════════════════════════════════
-- 042_consolidar_sesiones.sql
-- Problema: el código (login-empresa, refresh-token) escribe 5 columnas
-- que existen en producción por DDL manual pero NO están en migraciones:
--   token_hash, expires_at, revocada, device_info, legajo
-- Sin esta migración, un fresh deploy rompe login.
-- ════════════════════════════════════════════════════════════════════

-- 1. Columnas faltantes en sesiones
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS token_hash   text;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS expires_at   timestamptz;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS revocada     boolean DEFAULT false;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS device_info  text;
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS legajo       integer;

-- 2. Índice para búsqueda de sesiones activas por empresa (logout global)
CREATE INDEX IF NOT EXISTS idx_sesiones_empresa
  ON sesiones (empresa_id)
  WHERE revocada = false;

-- 3. Índice para token_hash (validación rápida de sesión por hash)
CREATE INDEX IF NOT EXISTS idx_sesiones_token_hash
  ON sesiones (token_hash)
  WHERE token_hash IS NOT NULL;

-- 4. Limpiar índice duplicado de migración 015
-- idx_sesiones_refresh_jti (010) e idx_sesiones_refresh_jti_015 (015) son idénticos.
DROP INDEX IF EXISTS idx_sesiones_refresh_jti_015;

-- 5. Backfill: sesiones sin expires_at usan expira_en como fallback
UPDATE sesiones
  SET expires_at = expira_en
  WHERE expires_at IS NULL AND expira_en IS NOT NULL;
