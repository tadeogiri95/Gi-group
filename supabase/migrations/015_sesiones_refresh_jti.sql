-- 015_sesiones_refresh_jti.sql
-- Asegura que la columna refresh_jti exista en sesiones para que los
-- logins nuevos puedan guardarla y /api/refresh-token pueda validarla.
-- Idempotente: IF NOT EXISTS permite correr más de una vez sin error.

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS refresh_jti text;

CREATE INDEX IF NOT EXISTS idx_sesiones_refresh_jti_015
  ON sesiones (refresh_jti)
  WHERE refresh_jti IS NOT NULL;

-- Limpiar sesiones viejas sin refresh_jti para forzar re-login limpio
-- (opcional — descomenta si querés invalidar todas las sesiones pre-fix)
-- DELETE FROM sesiones WHERE refresh_jti IS NULL;
