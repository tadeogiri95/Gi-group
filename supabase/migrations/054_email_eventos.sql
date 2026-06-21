-- 054: Tabla de eventos de Resend (delivered/opened/clicked/bounced) vía webhook.
-- Permite medir engagement de los emails transaccionales y de growth.
-- Fire-and-forget, solo server-side (igual que metricas_eventos).

CREATE TABLE IF NOT EXISTS email_eventos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resend_email_id text,
  tipo_email      text,
  evento          text        NOT NULL,
  empresa_id      uuid        REFERENCES empresa(id) ON DELETE SET NULL,
  destinatario    text,
  link            text,
  meta            jsonb       DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_eventos_empresa  ON email_eventos (empresa_id) WHERE empresa_id IS NOT NULL;
CREATE INDEX idx_email_eventos_tipo_evt ON email_eventos (tipo_email, evento);
CREATE INDEX idx_email_eventos_created  ON email_eventos (created_at);

ALTER TABLE email_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON email_eventos
  FOR ALL USING (current_setting('role') = 'service_role')
  WITH CHECK (current_setting('role') = 'service_role');

COMMENT ON TABLE email_eventos IS 'Eventos del webhook de Resend (sent/delivered/opened/clicked/bounced/complained). Solo server-side.';
