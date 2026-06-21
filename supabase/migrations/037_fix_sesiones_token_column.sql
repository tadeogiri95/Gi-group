-- ═══════════════════════════════════════════════════════════════════════════
-- 037_fix_sesiones_token_column.sql
--
-- Sentry reportó en producción: "column sesiones.token does not exist"
-- (Postgres 42703) en cada request autenticado. 001_tablas_base.sql define
-- `token text UNIQUE NOT NULL` desde el schema base, pero la tabla real en
-- producción no la tiene — mismo patrón de drift que geo_registros (036).
--
-- Impacto real: app/lib/auth.js consulta `sesiones?token=eq.<jti>` para
-- revocar sesiones. Como la columna no existe, esa consulta SIEMPRE falla
-- (42703) y el código hace fail-open (no expulsa a nadie) — la revocación
-- de sesiones nunca estuvo funcionando en producción. La app no se rompe
-- porque el fail-open la cubre, pero "cerrar sesión en todos los
-- dispositivos" o revocar tokens robados no tiene efecto real hasta correr
-- esto.
--
-- nullable (no NOT NULL): si hay filas existentes, un ADD COLUMN NOT NULL
-- sin default fallaría. Las sesiones viejas quedan con token=NULL — el
-- próximo refresh/login las regulariza.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS token text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_token
  ON sesiones (token)
  WHERE token IS NOT NULL;
