-- ═══════════════════════════════════════════════════════════════════
-- 008_audit_log.sql — Tabla de auditoría + timezone por empresa
-- ═══════════════════════════════════════════════════════════════════

-- ─── Timezone por empresa ───
ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Argentina/Buenos_Aires';

-- ─── Tabla audit_log ───
CREATE TABLE IF NOT EXISTS audit_log (
  id           bigserial PRIMARY KEY,
  empresa_id   uuid REFERENCES empresa(id) ON DELETE CASCADE,
  actor_id     uuid,
  actor_legajo int,
  actor_rol    text,
  accion       text NOT NULL,
  entidad      text,
  entidad_id   text,
  datos_antes  jsonb,
  datos_despues jsonb,
  ip           text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_empresa_time
  ON audit_log(empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log(actor_id, created_at DESC);

-- ─── RLS: solo el service_key puede insertar/leer ───
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- El service_key bypasea RLS, así que estas políticas solo aplican
-- a conexiones con tokens de usuario (anon/authenticated).
-- Las dejamos vacías para denegar todo acceso directo del cliente.
CREATE POLICY "audit_log_deny_all" ON audit_log
  FOR ALL USING (false);
