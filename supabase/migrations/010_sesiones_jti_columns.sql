-- ═══════════════════════════════════════════════════════════════════════════
-- 010_sesiones_jti_columns.sql — Columnas JWT para la tabla sesiones
--
-- ⚠️ NO EJECUTAR si ya están en producción.
-- Documentan columnas requeridas por el sistema JWT (Bloque 1E).
-- Verificar en Supabase Studio antes de ejecutar.
--
-- Cómo verificar:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'sesiones';
-- ═══════════════════════════════════════════════════════════════════════════

-- jti: ID único del access token actual de esta sesión (para tracking)
ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS jti text;

-- refresh_jti: ID del refresh token — se consulta en /api/refresh-token
-- para verificar que la sesión no fue revocada
ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS refresh_jti text;

-- Índice sobre refresh_jti: /api/refresh-token lo filtra por igualdad exacta
CREATE INDEX IF NOT EXISTS idx_sesiones_refresh_jti
  ON sesiones (refresh_jti)
  WHERE refresh_jti IS NOT NULL;
