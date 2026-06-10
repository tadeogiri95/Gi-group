-- ═══════════════════════════════════════════════════════════════════════════
-- 013_login_attempts.sql — Rate limiting de intentos de login por IP
--
-- Previene ataques de fuerza bruta en el endpoint /api/login-empresa.
-- Límite: 10 intentos por IP por ventana de 15 minutos.
-- Las ventanas vencidas se acumulan hasta la limpieza manual o via cron.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_attempts (
  ip      text NOT NULL,
  ventana text NOT NULL,   -- YYYY-MM-DDTHH:MM (bucket por minuto UTC)
  count   integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, ventana)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ventana
  ON login_attempts (ventana);

-- Limpieza programada de ventanas viejas (> 1 hora)
-- Llamar manualmente o via cron: DELETE FROM login_attempts WHERE ventana < TO_CHAR(NOW() - INTERVAL '1 hour', 'YYYY-MM-DD"T"HH24:MI');

-- RPC atómica: cuenta intento y retorna total de intentos en la ventana actual
CREATE OR REPLACE FUNCTION rpc_login_attempt(p_ip text, p_ventana text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO login_attempts (ip, ventana, count)
  VALUES (p_ip, p_ventana, 1)
  ON CONFLICT (ip, ventana)
  DO UPDATE SET count = login_attempts.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;
