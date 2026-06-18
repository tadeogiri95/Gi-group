-- 047: Tabla de eventos de métricas SaaS para tracking server-side.
-- Fire-and-forget desde API routes. Nunca bloquea la respuesta al usuario.

CREATE TABLE IF NOT EXISTS metricas_eventos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento      text        NOT NULL,
  empresa_id  uuid        REFERENCES empresa(id) ON DELETE SET NULL,
  empleado_id uuid        REFERENCES empleados(id) ON DELETE SET NULL,
  plan        text,
  meta        jsonb       DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_metricas_eventos_evento     ON metricas_eventos (evento);
CREATE INDEX idx_metricas_eventos_empresa    ON metricas_eventos (empresa_id) WHERE empresa_id IS NOT NULL;
CREATE INDEX idx_metricas_eventos_created    ON metricas_eventos (created_at);
CREATE INDEX idx_metricas_eventos_evt_date   ON metricas_eventos (evento, created_at);

-- RLS: solo service_role puede insertar/leer (server-side only)
ALTER TABLE metricas_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON metricas_eventos
  FOR ALL USING (current_setting('role') = 'service_role')
  WITH CHECK (current_setting('role') = 'service_role');

COMMENT ON TABLE metricas_eventos IS 'Eventos de tracking SaaS: registro, onboarding, fichaje, upgrade, churn. Solo server-side.';
