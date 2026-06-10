-- ═══════════════════════════════════════════════════════════════════════════
-- 011_rate_limits_and_indexes.sql
--
-- 1. Tabla rate_limits — persiste ventanas de rate limiting del chat IA
--    (reemplaza el Map in-memory que se resetea en cada cold start de Vercel)
-- 2. Índice en sesiones.jti — necesario para validarToken que ahora consulta
--    por jti en cada request autenticado
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── rate_limits ───
CREATE TABLE IF NOT EXISTS rate_limits (
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ventana     text NOT NULL,    -- YYYY-MM-DDTHH:MM (bucket por minuto UTC)
  count       integer NOT NULL DEFAULT 1,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (empresa_id, ventana)
);

-- Limpieza automática de ventanas viejas (> 2 horas) via RLS/cron o manualmente
CREATE INDEX IF NOT EXISTS idx_rate_limits_created_at ON rate_limits (created_at);

-- RPC atómica para check-and-increment (evita race conditions)
CREATE OR REPLACE FUNCTION rpc_check_rate_limit(
  p_empresa_id uuid,
  p_ventana    text,
  p_limite     integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO rate_limits (empresa_id, ventana, count)
  VALUES (p_empresa_id, p_ventana, 1)
  ON CONFLICT (empresa_id, ventana)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;


-- ─── Índice en sesiones.jti ───
-- validarToken ahora verifica el jti en cada request — este índice es crítico
CREATE INDEX IF NOT EXISTS idx_sesiones_jti
  ON sesiones (jti)
  WHERE jti IS NOT NULL;
