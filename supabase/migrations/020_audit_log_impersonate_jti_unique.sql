-- ═══════════════════════════════════════════════════════════════════════════
-- 020_audit_log_impersonate_jti_unique.sql — Anti-replay para códigos de
-- impersonación de superadmin.
--
-- El endpoint /api/superadmin/impersonate-exchange inserta una fila en
-- audit_log con accion='impersonate_exchange' y entidad_id=<JTI del código>.
-- Este índice único hace que el segundo intento de canjear el mismo código
-- falle con un error de constraint (409), incluso ante requests concurrentes.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_impersonate_exchange_jti
  ON audit_log (entidad_id)
  WHERE accion = 'impersonate_exchange';
