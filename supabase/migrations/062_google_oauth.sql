-- ═══════════════════════════════════════════════════════════════════════════
-- 062_google_oauth.sql — Soporte para "Continuar con Google" (OAuth 2.0/OIDC)
--
-- google_id = claim "sub" del id_token de Google: estable y único por cuenta
-- de Google. Scoped por empresa (igual que legajo): el mismo Google account
-- puede estar linkeado a empleados en empresas distintas sin colisión, porque
-- la identidad real del sistema sigue siendo (empresa_id, legajo) — no existe
-- noción de "usuario global".
--
-- El segundo índice es anti-replay para el código de intercambio de
-- /api/auth/google/exchange — mismo mecanismo que
-- 020_audit_log_impersonate_jti_unique.sql, con su propia "accion" para no
-- compartir namespace con impersonation.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS google_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_empleados_empresa_google_id
  ON empleados (empresa_id, google_id)
  WHERE google_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_oauth_exchange_jti
  ON audit_log (entidad_id)
  WHERE accion = 'oauth_exchange';
