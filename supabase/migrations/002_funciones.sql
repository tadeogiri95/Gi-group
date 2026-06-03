-- ═══════════════════════════════════════════════════════════════════════════
-- 002_funciones.sql — Funciones SQL referenciadas desde el código
--
-- ⚠️ NO EJECUTAR. Documentación del estado actual.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- validar_sesion(p_token) → fila con datos de la sesión activa
--
-- Llamada desde: /api/data, /api/fichar, /api/empresa, /api/config-empresa,
--                /api/billing/*, /api/login-empresa (vía RPC).
-- Devuelve los campos mínimos para identificar al usuario y su empresa.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION validar_sesion(p_token text)
RETURNS TABLE (
  empleado_id  uuid,
  legajo       integer,
  empresa_id   uuid,
  rol          text,
  expira_en    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id          AS empleado_id,
    e.legajo,
    e.empresa_id,
    e.rol,
    s.expira_en
  FROM sesiones s
  JOIN empleados e ON e.id = s.empleado_id
  WHERE s.token = p_token
    AND s.expira_en > now()
    AND e.activo = true
  LIMIT 1;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- crear_sesion(p_empleado_id, p_empresa_id, p_ip, p_user_agent)
--   → ( token text, expira_en timestamptz )
--
-- Genera un token aleatorio y lo guarda en `sesiones`. Llamada desde el
-- login (/api/login-empresa). Duración por defecto: 30 días -- VERIFICAR.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION crear_sesion(
  p_empleado_id uuid,
  p_empresa_id  uuid,
  p_ip          text,
  p_user_agent  text
)
RETURNS TABLE (token text, expira_en timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token     text;
  v_expira    timestamptz;
BEGIN
  v_token  := encode(gen_random_bytes(32), 'hex');     -- 64 hex chars
  v_expira := now() + interval '30 days';              -- VERIFICAR duración

  INSERT INTO sesiones (token, empleado_id, empresa_id, ip, user_agent, expira_en)
  VALUES (v_token, p_empleado_id, p_empresa_id, p_ip, p_user_agent, v_expira);

  RETURN QUERY SELECT v_token, v_expira;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- limpiar_sesiones_expiradas()
--
-- Borra sesiones vencidas. Llamada desde /api/cron/auto-fichaje cada 30 min.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION limpiar_sesiones_expiradas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_borradas integer;
BEGIN
  DELETE FROM sesiones WHERE expira_en < now();
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- auto_fichar_egresos()
--
-- CRON inteligente: para cada empleado activo, si tiene fichada de ingreso
-- hoy pero no de egreso, y ya pasó X minutos de su hora_out según diagrama,
-- le cierra la fichada automáticamente. Se llama cada 30 min desde
-- /api/cron/auto-fichaje (Vercel CRON).
--
-- Lógica esperada (según referencias en el código):
--   1. Recorre empleados.activo = true
--   2. Lee diagrama → hora_out del día actual
--   3. Si LOCALTIME > hora_out + tolerancia y hay ingreso sin egreso,
--      hace UPDATE fichadas SET egreso = hora_out (no la hora actual,
--      para no inflar las horas trabajadas).
--   4. También cierra registro_actividades con hora_fin = NULL.
--
-- ⚠️ Importante: usar LOCALTIME, no CURRENT_TIME (este último devuelve
-- "time with time zone" y rompe comparaciones en este entorno Supabase).
-- Para to_char(), usar now().
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auto_fichar_egresos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp           record;
  v_dia_key       text;
  v_hora_out      text;
  v_hora_actual   time;
  v_cerradas      integer := 0;
  v_resultado     jsonb;
BEGIN
  -- VERIFICAR: lógica completa contra implementación en producción.
  -- El esqueleto refleja el comportamiento conocido pero los detalles
  -- (tolerancia exacta, formato del diagrama, manejo de zona horaria
  -- Argentina) deben confirmarse contra la función real.

  v_hora_actual := LOCALTIME;
  v_dia_key := CASE EXTRACT(DOW FROM now())
    WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
    WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie'
    WHEN 6 THEN 'sab' END;

  FOR v_emp IN
    SELECT e.id, e.legajo, e.empresa_id, e.diagrama,
           f.id AS fichada_id, f.ingreso
      FROM empleados e
      JOIN fichadas f
        ON f.empleado_id = e.id
       AND f.fecha = CURRENT_DATE
       AND f.ingreso IS NOT NULL
       AND f.egreso  IS NULL
     WHERE e.activo = true
  LOOP
    v_hora_out := v_emp.diagrama -> v_dia_key ->> 'out';
    IF v_hora_out IS NOT NULL
       AND v_hora_actual > (v_hora_out::time + interval '15 minutes') THEN
      UPDATE fichadas
         SET egreso = v_hora_out::time
       WHERE id = v_emp.fichada_id;

      UPDATE registro_actividades
         SET hora_fin = (CURRENT_DATE || ' ' || v_hora_out)::timestamptz
       WHERE empleado_id = v_emp.id
         AND hora_fin IS NULL;

      v_cerradas := v_cerradas + 1;
    END IF;
  END LOOP;

  v_resultado := jsonb_build_object(
    'ok', true,
    'cerradas', v_cerradas,
    'corrida_en', now()
  );
  RETURN v_resultado;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- iniciar_trial_pro(p_empresa_id)
--
-- Crea una suscripción en estado 'trial' por 14 días para una empresa nueva.
-- Llamada desde /api/registro-empresa al crear la cuenta.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION iniciar_trial_pro(p_empresa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Marcar trial_usado en empresa
  UPDATE empresa SET trial_usado = true WHERE id = p_empresa_id;

  -- Crear suscripción trial 14 días
  INSERT INTO suscripciones (
    empresa_id, plan, estado, trial_inicio, trial_fin
  ) VALUES (
    p_empresa_id, 'pro', 'trial', now(), now() + interval '14 days'
  );
END;
$$;
