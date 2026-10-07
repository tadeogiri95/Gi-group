-- ═══════════════════════════════════════════════════════════════════════════
-- LÍNEA BASE DEL ESQUEMA (F3-09 / F0-05 / F3-11)
--
-- Estructura completa del esquema public de PRODUCCIÓN al 2026-10-07, con todas
-- las migraciones hasta la 072 aplicadas. SIN datos. Exportada con el workflow
-- "Exportar esquema de producción" (pg_dump --schema-only).
--
-- Para qué sirve: crear desde cero una base idéntica a producción (staging,
-- pruebas locales, recuperación). Las migraciones 001–072 quedan como
-- historial; las nuevas (073 en adelante) se aplican DESPUÉS de este archivo.
--
-- Solo para una base VACÍA de Supabase (usa auth.users y los roles anon,
-- authenticated y service_role que Supabase trae de fábrica). Lo aplica el
-- workflow "Preparar base de staging".
-- ═══════════════════════════════════════════════════════════════════════════

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Producción no le da permisos sobre tablas a anon/authenticated (limpieza
-- post-incidente, migración 066). Un proyecto nuevo de Supabase sí lo hace
-- por defecto: se quita ANTES de crear nada para que staging quede igual.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: auto_fichar_egresos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_fichar_egresos() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_emp           record;
  v_dia_key       text;
  v_hora_out      text;
  v_cerradas      integer := 0;
  v_out_ts        timestamp;
BEGIN
  FOR v_emp IN
    SELECT e.id, e.legajo, e.empresa_id, e.diagrama,
           f.id AS fichada_id, f.ingreso, f.fecha AS fichada_fecha,
           COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires') AS tz
      FROM empleados e
      JOIN fichadas f
        ON f.empleado_id = e.id
       AND f.ingreso IS NOT NULL
       AND f.egreso  IS NULL
      JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.activo = true
       AND f.fecha <  (now() AT TIME ZONE COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires'))::date
       AND f.fecha >= (now() AT TIME ZONE COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires'))::date - interval '3 days'
  LOOP
    -- El día de semana de la fichada (no el de "ahora") decide qué
    -- horario de diagrama le corresponde.
    v_dia_key := CASE EXTRACT(DOW FROM v_emp.fichada_fecha)
      WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
      WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie'
      WHEN 6 THEN 'sab' END;

    v_hora_out := v_emp.diagrama -> v_dia_key ->> 'out';

    IF v_hora_out IS NOT NULL THEN
      -- Timestamp completo de cierre: fecha de la fichada + hora de
      -- salida programada. Si esa hora es <= la hora de ingreso, el
      -- turno cruzó medianoche → el cierre cae un día después.
      v_out_ts := (v_emp.fichada_fecha || ' ' || v_hora_out)::timestamp;
      IF v_hora_out::time <= v_emp.ingreso::time THEN
        v_out_ts := v_out_ts + interval '1 day';
      END IF;

      -- Comparación en timestamp completo (no "hora suelta del día",
      -- que es lo que rompía turnos nocturnos) contra el reloj actual.
      IF (now() AT TIME ZONE v_emp.tz) > (v_out_ts + interval '15 minutes') THEN
        UPDATE fichadas
           SET egreso = v_hora_out::time,
               horas_trabajadas = ROUND(
                 EXTRACT(EPOCH FROM (
                   v_out_ts - (v_emp.fichada_fecha || ' ' || v_emp.ingreso)::timestamp
                 )) / 3600.0, 2
               )
         WHERE id = v_emp.fichada_id;

        UPDATE registro_actividades
           SET hora_fin = v_out_ts AT TIME ZONE v_emp.tz
         WHERE empleado_id = v_emp.id
           AND hora_fin IS NULL;

        v_cerradas := v_cerradas + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cerradas', v_cerradas, 'ts', now());
END;
$$;


--
-- Name: crear_sesion(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_sesion(p_empleado_id uuid, p_empresa_id uuid, p_ip text DEFAULT ''::text, p_user_agent text DEFAULT ''::text) RETURNS TABLE(out_token text, out_expires_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_token text;
  v_expires timestamptz;
  v_legajo text;
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + interval '7 days';
  
  SELECT e.legajo::text INTO v_legajo 
  FROM empleados e WHERE e.id = p_empleado_id;

  INSERT INTO sesiones (empleado_id, legajo, empresa_id, token_hash, device_info, expires_at, revocada)
  VALUES (p_empleado_id, v_legajo, p_empresa_id, v_token, p_ip || ' | ' || p_user_agent, v_expires, false);

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;


--
-- Name: fichadas_hoy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fichadas_hoy() RETURNS TABLE(legajo integer, nombre text, ingreso time without time zone, egreso time without time zone, horas_trabajadas numeric)
    LANGUAGE sql
    AS $$
  SELECT f.legajo, e.nombre, f.ingreso, f.egreso, f.horas_trabajadas
  FROM fichadas f
  JOIN empleados e ON e.legajo = f.legajo
  WHERE f.fecha = CURRENT_DATE
  ORDER BY f.ingreso;
$$;


--
-- Name: fichadas_semana(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fichadas_semana(p_legajo integer) RETURNS TABLE(fecha date, ingreso time without time zone, egreso time without time zone, horas_trabajadas numeric)
    LANGUAGE sql
    AS $$
  SELECT f.fecha, f.ingreso, f.egreso, f.horas_trabajadas
  FROM fichadas f
  WHERE f.legajo = p_legajo
    AND f.fecha >= date_trunc('week', CURRENT_DATE)
    AND f.fecha <= CURRENT_DATE
  ORDER BY f.fecha;
$$;


--
-- Name: fichar_egreso(uuid, text, uuid, boolean, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fichar_egreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_forzar_cierre_tarea boolean DEFAULT false, p_geo_lat double precision DEFAULT NULL::double precision, p_geo_lng double precision DEFAULT NULL::double precision, p_geo_distancia integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_hoy DATE := CURRENT_DATE;
  v_ahora TIME := LOCALTIME;
  v_hora_str TEXT := to_char(now(), 'HH24:MI');
  v_fichada RECORD; v_tarea_activa RECORD;
  v_horas_trab NUMERIC; v_horas_extras NUMERIC := NULL;
  v_min_ingreso INT; v_min_egreso INT; v_min_trabajados INT;
  v_dia_semana INT; v_jornada_habitual INT := 540;
  v_geo_json JSONB := NULL; v_config RECORD; v_min_almuerzo INT := 0;
BEGIN
  SELECT * INTO v_fichada FROM fichadas
    WHERE legajo = p_legajo::integer AND fecha = v_hoy AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No tenés fichada de ingreso hoy');
  END IF;
  IF v_fichada.egreso IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya fichaste egreso hoy', 'tipo', 'ya_fichado');
  END IF;

  SELECT * INTO v_tarea_activa FROM registro_actividades
    WHERE empleado_id = p_empleado_id AND hora_fin IS NULL LIMIT 1;
  IF FOUND AND NOT p_forzar_cierre_tarea THEN
    RETURN jsonb_build_object('ok', false, 'tipo', 'tarea_activa',
      'error', 'Tenés una actividad activa en curso. ¿Querés finalizar y fichar salida?',
      'tarea_id', v_tarea_activa.id);
  END IF;
  IF FOUND AND p_forzar_cierre_tarea THEN
    UPDATE registro_actividades SET hora_fin = NOW() WHERE id = v_tarea_activa.id;
  END IF;

  v_min_ingreso := (split_part(v_fichada.ingreso, ':', 1)::INT) * 60 
                 + (split_part(v_fichada.ingreso, ':', 2)::INT);
  v_min_egreso := EXTRACT(HOUR FROM v_ahora)::INT * 60 + EXTRACT(MINUTE FROM v_ahora)::INT;
  v_min_trabajados := v_min_egreso - v_min_ingreso;

  BEGIN
    SELECT * INTO v_config FROM config_sistema
      WHERE empresa_id = p_empresa_id AND clave = 'minutos_almuerzo';
    IF FOUND THEN v_min_almuerzo := (v_config.valor)::INT; END IF;
  EXCEPTION WHEN OTHERS THEN v_min_almuerzo := 0;
  END;

  IF v_min_almuerzo > 0 AND v_min_trabajados > (v_jornada_habitual / 2) THEN
    v_min_trabajados := v_min_trabajados - v_min_almuerzo;
  END IF;
  v_horas_trab := ROUND(v_min_trabajados / 60.0, 2);

  v_dia_semana := EXTRACT(DOW FROM v_hoy)::INT;
  IF v_dia_semana BETWEEN 1 AND 5 AND v_min_trabajados > v_jornada_habitual THEN
    v_horas_extras := ROUND((v_min_trabajados - v_jornada_habitual) / 60.0, 2);
  ELSIF v_dia_semana IN (0, 6) THEN
    v_horas_extras := v_horas_trab;
  END IF;

  IF p_geo_lat IS NOT NULL AND p_geo_lng IS NOT NULL THEN
    v_geo_json := jsonb_build_object('lat', p_geo_lat, 'lng', p_geo_lng, 'distancia', p_geo_distancia);
  END IF;

  UPDATE fichadas SET egreso = v_hora_str, horas_trabajadas = v_horas_trab,
    horas_extras = v_horas_extras, minutos_almuerzo = v_min_almuerzo, geo_egreso = v_geo_json
  WHERE id = v_fichada.id;

  RETURN jsonb_build_object('ok', true, 'hora', v_hora_str,
    'horas_trabajadas', v_horas_trab, 'horas_extras', v_horas_extras,
    'almuerzo_descontado', v_min_almuerzo);
END;
$$;


--
-- Name: fichar_ingreso(uuid, text, uuid, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fichar_ingreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_geo_lat double precision DEFAULT NULL::double precision, p_geo_lng double precision DEFAULT NULL::double precision, p_geo_distancia integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_hoy DATE := CURRENT_DATE;
  v_ahora TIME := LOCALTIME;
  v_hora_str TEXT := to_char(now(), 'HH24:MI');
  v_empleado RECORD; v_diagrama JSONB; v_dia_key TEXT; v_dia_config JSONB;
  v_entrada_prog INT; v_salida_prog INT; v_entrada_real INT; v_diff_min INT;
  v_llegadas_tarde INT; v_tiene_permiso BOOLEAN := FALSE;
  v_fichada_existente RECORD; v_geo_json JSONB := NULL;
  v_tardanza JSONB := NULL; v_resultado JSONB;
BEGIN
  SELECT * INTO v_empleado FROM empleados
    WHERE id = p_empleado_id AND empresa_id = p_empresa_id AND activo = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Empleado no encontrado o inactivo');
  END IF;

  SELECT * INTO v_fichada_existente FROM fichadas
    WHERE legajo = p_legajo::integer AND fecha = v_hoy AND empresa_id = p_empresa_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya fichaste ingreso hoy', 'tipo', 'ya_fichado');
  END IF;

  v_dia_key := CASE EXTRACT(DOW FROM v_hoy)
    WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
    WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie' WHEN 6 THEN 'sab'
  END;
  v_diagrama := v_empleado.diagrama;
  v_dia_config := v_diagrama -> v_dia_key;

  IF v_dia_config IS NOT NULL AND v_dia_config ->> 'in' IS NOT NULL THEN
    v_entrada_prog := (split_part(v_dia_config ->> 'in', ':', 1)::INT) * 60 
                    + (split_part(v_dia_config ->> 'in', ':', 2)::INT);
    v_salida_prog := (split_part(v_dia_config ->> 'out', ':', 1)::INT) * 60 
                   + (split_part(v_dia_config ->> 'out', ':', 2)::INT);
    v_entrada_real := EXTRACT(HOUR FROM v_ahora)::INT * 60 + EXTRACT(MINUTE FROM v_ahora)::INT;

    IF v_entrada_real >= v_salida_prog THEN
      RETURN jsonb_build_object('ok', false, 'tipo', 'bloqueado_horario',
        'error', 'No se puede fichar ingreso después del horario de salida (' || (v_dia_config ->> 'out') || ')');
    END IF;

    v_diff_min := v_entrada_real - v_entrada_prog;
    
    IF v_diff_min > 0 THEN
      SELECT COUNT(*) INTO v_llegadas_tarde FROM fichadas
        WHERE legajo = p_legajo::integer AND empresa_id = p_empresa_id
          AND fecha >= date_trunc('month', v_hoy)::DATE AND fecha < v_hoy
          AND llegada_tarde = true;
      v_llegadas_tarde := v_llegadas_tarde + 1;

      IF v_diff_min > 30 THEN
        SELECT EXISTS(SELECT 1 FROM solicitudes
            WHERE legajo = p_legajo::integer AND empresa_id = p_empresa_id
              AND fecha = v_hoy::TEXT AND estado = 'aprobado'
              AND (motivo ILIKE '%INGRESO%' OR motivo ILIKE '%🔓%')
        ) INTO v_tiene_permiso;

        IF NOT v_tiene_permiso THEN
          INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
          VALUES ('gerencial', 'alerta', '⛔ ' || v_empleado.apodo || ' BLOQUEADO — requiere permiso',
            'Tardanza de ' || v_diff_min || ' min (supera 30min). Requiere autorización.', 'alta', p_empresa_id);
          INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
          VALUES (p_legajo, 'alerta', '⛔ Ingreso bloqueado', 'Contactá a gerencia para que autorice tu ingreso.', 'alta', p_empresa_id);
          RETURN jsonb_build_object('ok', false, 'tipo', 'bloqueado_tardanza',
            'error', 'Ingreso bloqueado por tardanza de ' || v_diff_min || ' minutos. Necesitás autorización de gerencia.',
            'minutos_tarde', v_diff_min, 'llegadas_tarde', v_llegadas_tarde);
        END IF;
        v_tardanza := jsonb_build_object('estado', 'tarde', 'minutos', v_diff_min, 'llegadasTarde', v_llegadas_tarde);

      ELSIF v_llegadas_tarde >= 3 THEN
        SELECT EXISTS(SELECT 1 FROM solicitudes
            WHERE legajo = p_legajo::integer AND empresa_id = p_empresa_id
              AND fecha = v_hoy::TEXT AND estado = 'aprobado'
              AND (motivo ILIKE '%INGRESO%' OR motivo ILIKE '%🔓%')
        ) INTO v_tiene_permiso;

        IF NOT v_tiene_permiso THEN
          INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
          VALUES ('gerencial', 'alerta', '⛔ ' || v_empleado.apodo || ' BLOQUEADO — 3ra llegada tarde',
            '3ra llegada tarde del mes (+' || v_diff_min || 'min). Requiere autorización.', 'alta', p_empresa_id);
          INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
          VALUES (p_legajo, 'alerta', '⛔ Ingreso bloqueado', 'Contactá a gerencia para que autorice tu ingreso.', 'alta', p_empresa_id);
          RETURN jsonb_build_object('ok', false, 'tipo', 'bloqueado_3ra_tarde',
            'error', 'Ingreso bloqueado. Acumulaste 3 llegadas tarde este mes. Necesitás autorización de gerencia.',
            'minutos_tarde', v_diff_min, 'llegadas_tarde', v_llegadas_tarde);
        END IF;
        v_tardanza := jsonb_build_object('estado', 'tarde', 'minutos', v_diff_min, 'llegadasTarde', v_llegadas_tarde);
      ELSE
        v_tardanza := jsonb_build_object('estado', 'tarde', 'minutos', v_diff_min, 'llegadasTarde', v_llegadas_tarde);
      END IF;

      INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
      VALUES ('gerencial', 'alerta', '⚠️ Llegada tarde de ' || v_empleado.apodo,
        'Llegada tarde #' || v_llegadas_tarde || ': +' || v_diff_min || ' min',
        CASE WHEN v_diff_min > 30 THEN 'alta' ELSE 'normal' END, p_empresa_id);
      INSERT INTO notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, empresa_id)
      VALUES (p_legajo, 'info', '⚠️ Llegada tarde: +' || v_diff_min || ' min',
        'Llegada tarde #' || v_llegadas_tarde || ' del mes.', 'normal', p_empresa_id);
    END IF;
  END IF;

  IF p_geo_lat IS NOT NULL AND p_geo_lng IS NOT NULL THEN
    v_geo_json := jsonb_build_object('lat', p_geo_lat, 'lng', p_geo_lng, 'distancia', p_geo_distancia);
  END IF;

  INSERT INTO fichadas (empleado_id, legajo, fecha, ingreso, llegada_tarde, minutos_tarde, geo_ingreso, empresa_id)
  VALUES (p_empleado_id, p_legajo::integer, v_hoy, v_hora_str,
    COALESCE((v_tardanza IS NOT NULL), false),
    COALESCE((v_tardanza ->> 'minutos')::INT, 0),
    v_geo_json, p_empresa_id);

  RETURN jsonb_build_object('ok', true, 'hora', v_hora_str, 'tardanza', v_tardanza);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Ya fichaste ingreso hoy', 'tipo', 'ya_fichado');
END;
$$;


--
-- Name: fn_calcular_duracion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calcular_duracion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.hora_fin IS NOT NULL AND OLD.hora_fin IS NULL THEN
    NEW.duracion_min := ROUND(
      EXTRACT(EPOCH FROM (NEW.hora_fin - NEW.hora_inicio)) / 60.0, 2
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_cerrar_tarea_previa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cerrar_tarea_previa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE registro_actividades
  SET hora_fin     = NEW.hora_inicio,
      duracion_min = ROUND(
        EXTRACT(EPOCH FROM (NEW.hora_inicio - hora_inicio)) / 60.0, 2
      )
  WHERE empleado_id = NEW.empleado_id
    AND hora_fin IS NULL
    AND id != NEW.id;
  RETURN NEW;
END;
$$;


--
-- Name: iniciar_trial_pro(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iniciar_trial_pro(p_empresa_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  trial_id UUID;
  ya_uso BOOLEAN;
BEGIN
  -- Si la empresa ya usó trial alguna vez, no le damos otro
  SELECT trial_usado INTO ya_uso FROM empresa WHERE id = p_empresa_id;
  IF ya_uso THEN
    RETURN NULL;
  END IF;

  -- Marcar suscripciones previas como canceladas
  UPDATE suscripciones SET estado = 'cancelada' WHERE empresa_id = p_empresa_id AND estado IN ('activa','trial');

  -- Crear nuevo trial Pro de 14 días
  INSERT INTO suscripciones (empresa_id, plan, estado, trial_inicio, trial_fin, precio, moneda, gateway)
  VALUES (p_empresa_id, 'pro', 'trial', NOW(), NOW() + INTERVAL '14 days', 0, 'ARS', 'manual')
  RETURNING id INTO trial_id;

  -- Actualizar cache
  UPDATE empresa
  SET plan_activo = 'pro', suscripcion_activa_id = trial_id
  WHERE id = p_empresa_id;

  RETURN trial_id;
END;
$$;


--
-- Name: limpiar_push_tokens_huerfanos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpiar_push_tokens_huerfanos() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_borrados integer;
BEGIN
  DELETE FROM push_tokens pt
   WHERE NOT EXISTS (
     SELECT 1 FROM empleados e
      WHERE e.empresa_id = pt.empresa_id
        AND e.legajo     = pt.legajo
        AND e.activo     = true
   );
  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  RETURN v_borrados;
END;
$$;


--
-- Name: limpiar_sesiones_expiradas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.limpiar_sesiones_expiradas() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE sesiones SET activa = false WHERE expires_at < now();
END;
$$;


--
-- Name: rpc_check_rate_limit(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_check_rate_limit(p_empresa_id uuid, p_ventana text, p_limite integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
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


--
-- Name: rpc_churn_mensual(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_churn_mensual() RETURNS TABLE(mes text, churned bigint, activas_inicio bigint, churn_rate numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH meses AS (
    SELECT to_char(d, 'YYYY-MM') AS mes, d AS fecha_inicio, (d + interval '1 month') AS fecha_fin
    FROM generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    ) d
  ),
  churn_por_mes AS (
    SELECT to_char(me.created_at, 'YYYY-MM') AS mes,
           COUNT(DISTINCT me.empresa_id) AS churned
      FROM metricas_eventos me
     WHERE me.evento = 'churn'
     GROUP BY to_char(me.created_at, 'YYYY-MM')
  ),
  activas_por_mes AS (
    SELECT m.mes, COUNT(DISTINCT s.empresa_id) AS activas_inicio
      FROM meses m
      JOIN suscripciones s
        ON s.estado = 'activa'
       AND s.created_at < m.fecha_inicio
     GROUP BY m.mes
  )
  SELECT
    m.mes,
    COALESCE(cm.churned, 0)         AS churned,
    COALESCE(am.activas_inicio, 0)  AS activas_inicio,
    CASE
      WHEN COALESCE(am.activas_inicio, 0) > 0
      THEN ROUND(COALESCE(cm.churned, 0)::numeric / am.activas_inicio::numeric * 100, 1)
      ELSE 0
    END AS churn_rate
  FROM meses m
  LEFT JOIN churn_por_mes  cm ON cm.mes = m.mes
  LEFT JOIN activas_por_mes am ON am.mes = m.mes
  ORDER BY m.mes;
END;
$$;


--
-- Name: rpc_conversion_cohortes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_conversion_cohortes() RETURNS TABLE(cohorte text, registradas bigint, completaron_onboarding bigint, primera_fichada bigint, convirtieron_pago bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH cohortes AS (
    SELECT
      to_char(e.created_at, 'YYYY-MM') AS cohorte,
      e.id AS empresa_id,
      e.onboarding_completado
    FROM empresa e
    WHERE e.created_at >= now() - interval '12 months'
  )
  SELECT
    c.cohorte,
    COUNT(DISTINCT c.empresa_id) AS registradas,
    COUNT(DISTINCT c.empresa_id) FILTER (WHERE c.onboarding_completado = true) AS completaron_onboarding,
    COUNT(DISTINCT f.empresa_id) AS primera_fichada,
    COUNT(DISTINCT s.empresa_id) AS convirtieron_pago
  FROM cohortes c
  LEFT JOIN LATERAL (
    SELECT empresa_id FROM fichadas WHERE empresa_id = c.empresa_id LIMIT 1
  ) f ON true
  LEFT JOIN suscripciones s ON s.empresa_id = c.empresa_id
    AND s.estado IN ('activa')
    AND s.plan IN ('starter', 'pro', 'enterprise')
  GROUP BY c.cohorte
  ORDER BY c.cohorte;
END;
$$;


--
-- Name: rpc_crear_empresa_con_admin(text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_crear_empresa_con_admin(p_nombre_empresa text, p_nombre_corto text, p_admin_email text, p_admin_password text, p_rubro text, p_slug text, p_admin_nombre text, p_email_verify_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_empresa_id uuid;
  v_empleado_id uuid;
BEGIN
  INSERT INTO empresa (
    nombre, nombre_corto, admin_email, admin_password,
    rubro, slug, plan_activo, trial_usado, max_empleados,
    activa, email_verificado, email_verify_token
  ) VALUES (
    p_nombre_empresa, p_nombre_corto, p_admin_email, p_admin_password,
    p_rubro, p_slug, 'free', false, 10,
    true, false, p_email_verify_token
  )
  RETURNING id INTO v_empresa_id;

  INSERT INTO empleados (
    nombre, apodo, legajo, email, password,
    rol, area, division, activo, empresa_id,
    debe_cambiar_password
  ) VALUES (
    p_admin_nombre, split_part(p_admin_nombre, ' ', 1), 1, p_admin_email, p_admin_password,
    'gerencial', 'administración', 'general', true, v_empresa_id,
    false
  )
  RETURNING id INTO v_empleado_id;

  RETURN jsonb_build_object(
    'empresa_id', v_empresa_id,
    'empleado_id', v_empleado_id
  );
END;
$$;


--
-- Name: rpc_funnel_activacion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_funnel_activacion() RETURNS TABLE(paso text, cantidad bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 'registradas'::text, COUNT(*) FROM empresa
  UNION ALL
  SELECT 'onboarding_completo'::text, COUNT(*) FROM empresa WHERE onboarding_completado = true
  UNION ALL
  SELECT 'primera_fichada'::text, COUNT(DISTINCT empresa_id) FROM fichadas
  UNION ALL
  SELECT 'trial_to_paid'::text, COUNT(DISTINCT empresa_id) FROM suscripciones WHERE estado = 'activa' AND plan IN ('starter', 'pro', 'enterprise');
END;
$$;


--
-- Name: rpc_login_attempt(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_login_attempt(p_ip text, p_ventana text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
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


--
-- Name: rpc_mrr_trending(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_mrr_trending() RETURNS TABLE(mes text, mrr numeric, suscripciones_activas bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH meses AS (
    SELECT to_char(d, 'YYYY-MM') AS mes, d AS fecha_inicio, (d + interval '1 month') AS fecha_fin
    FROM generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    ) d
  )
  SELECT
    m.mes,
    COALESCE(SUM(
      CASE WHEN s.periodo = 'anual' THEN s.precio ELSE s.precio END
    ), 0)::numeric AS mrr,
    COUNT(s.id) AS suscripciones_activas
  FROM meses m
  LEFT JOIN suscripciones s ON s.estado = 'activa'
    AND s.created_at < m.fecha_fin
    AND (s.periodo_fin IS NULL OR s.periodo_fin >= m.fecha_inicio)
  GROUP BY m.mes, m.fecha_inicio
  ORDER BY m.mes;
END;
$$;


--
-- Name: rpc_revenue_por_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_revenue_por_plan() RETURNS TABLE(plan text, empresas bigint, mrr numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.plan,
    COUNT(DISTINCT s.empresa_id) AS empresas,
    COALESCE(SUM(s.precio), 0)::numeric AS mrr
  FROM suscripciones s
  WHERE s.estado = 'activa'
  GROUP BY s.plan
  ORDER BY mrr DESC;
END;
$$;


--
-- Name: rpc_superadmin_empresas(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_superadmin_empresas(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_rows    jsonb;
  v_total   bigint;
BEGIN
  -- Total count (with optional search filter)
  SELECT count(*)
    INTO v_total
    FROM empresa e
   WHERE (p_search IS NULL OR p_search = ''
          OR e.nombre       ILIKE '%' || p_search || '%'
          OR e.nombre_corto ILIKE '%' || p_search || '%'
          OR e.slug         ILIKE '%' || p_search || '%');

  -- Paginated rows with aggregated data
  SELECT coalesce(jsonb_agg(row_data ORDER BY row_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'id',                     e.id,
        'nombre',                 e.nombre,
        'nombre_corto',           e.nombre_corto,
        'slug',                   e.slug,
        'plan_activo',            e.plan_activo,
        'activa',                 e.activa,
        'created_at',             e.created_at,
        'onboarding_completado',  e.onboarding_completado,
        'trial_usado',            e.trial_usado,
        'empleados_activos',      coalesce(emp.cnt, 0),
        'suscripcion',            CASE WHEN s.empresa_id IS NOT NULL
                                    THEN jsonb_build_object(
                                      'empresa_id', s.empresa_id,
                                      'estado',     s.estado,
                                      'plan',       s.plan,
                                      'monto',      s.monto,
                                      'created_at', s.created_at,
                                      'trial_fin',  s.trial_fin
                                    )
                                    ELSE NULL
                                  END
      ) AS row_data
      FROM empresa e

      -- Employee count per company
      LEFT JOIN LATERAL (
        SELECT count(*) AS cnt
          FROM empleados
         WHERE empleados.empresa_id = e.id
           AND empleados.activo = true
      ) emp ON true

      -- Latest or active subscription per company
      LEFT JOIN LATERAL (
        SELECT s2.empresa_id, s2.estado, s2.plan, s2.monto, s2.created_at, s2.trial_fin
          FROM suscripciones s2
         WHERE s2.empresa_id = e.id
         ORDER BY (s2.estado = 'activa') DESC, s2.created_at DESC
         LIMIT 1
      ) s ON true

      WHERE (p_search IS NULL OR p_search = ''
             OR e.nombre       ILIKE '%' || p_search || '%'
             OR e.nombre_corto ILIKE '%' || p_search || '%'
             OR e.slug         ILIKE '%' || p_search || '%')

      ORDER BY e.created_at DESC
      LIMIT  p_limit
      OFFSET p_offset
    ) sub;

  RETURN jsonb_build_object(
    'empresas', v_rows,
    'total',    v_total
  );
END;
$$;


--
-- Name: rpc_superadmin_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_superadmin_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_total      bigint;
  v_activas    bigint;
  v_trials     bigint;
  v_mrr        numeric;
  v_por_plan   jsonb;
  v_trial_usado     bigint;
  v_convertidas     bigint;
  v_perdidas_trial  bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE activa = true),
         count(*) FILTER (WHERE plan_activo = 'trial'),
         count(*) FILTER (WHERE trial_usado = true),
         count(*) FILTER (WHERE trial_usado = true AND plan_activo IN ('starter','pro','enterprise')),
         count(*) FILTER (WHERE trial_usado = true AND plan_activo = 'free')
    INTO v_total, v_activas, v_trials, v_trial_usado, v_convertidas, v_perdidas_trial
    FROM empresa;

  SELECT coalesce(sum(s.monto), 0)
    INTO v_mrr
    FROM suscripciones s
   WHERE s.estado = 'activa';

  SELECT coalesce(jsonb_agg(jsonb_build_object('plan', p.plan, 'count', p.cnt)), '[]'::jsonb)
    INTO v_por_plan
    FROM (
      SELECT plan_activo AS plan, count(*) AS cnt
        FROM empresa
       GROUP BY plan_activo
       ORDER BY plan_activo
    ) p;

  RETURN jsonb_build_object(
    'total',           v_total,
    'activas',         v_activas,
    'trials',          v_trials,
    'mrr',             v_mrr,
    'por_plan',        v_por_plan,
    'trial_usado',     v_trial_usado,
    'convertidas',     v_convertidas,
    'perdidas_trial',  v_perdidas_trial
  );
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: trg_susc_updated(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_susc_updated() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


--
-- Name: validar_sesion(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validar_sesion(p_token text) RETURNS TABLE(empleado_id uuid, empresa_id uuid, legajo text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT s.empleado_id, s.empresa_id, s.legajo
  FROM sesiones s
  WHERE s.token_hash = p_token 
    AND s.expires_at > now()
    AND (s.revocada IS NULL OR s.revocada = false);
END;
$$;


--
-- Name: vencer_trial_atomico(bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vencer_trial_atomico(p_suscripcion_id bigint, p_empresa_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  UPDATE suscripciones
    SET estado = 'vencida'
    WHERE id = p_suscripcion_id
      AND estado = 'trial';

  UPDATE empresa
    SET plan_activo          = 'free',
        suscripcion_activa_id = NULL
    WHERE id = p_empresa_id
      AND plan_activo = 'trial';
END;
$$;


--
-- Name: vencer_trials_batch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vencer_trials_batch() RETURNS TABLE(empresa_id uuid, nombre text, nombre_corto text, slug text, admin_email text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH vencidas AS (
    UPDATE suscripciones
      SET estado = 'vencida'
      WHERE estado = 'trial' AND trial_fin < now()
      RETURNING suscripciones.empresa_id
  ),
  empresas_afectadas AS (
    UPDATE empresa
      SET plan_activo = 'free',
          suscripcion_activa_id = NULL
      WHERE empresa.id IN (SELECT v.empresa_id FROM vencidas v)
        AND empresa.plan_activo = 'trial'
      RETURNING empresa.id, empresa.nombre, empresa.nombre_corto, empresa.slug, empresa.admin_email
  )
  SELECT DISTINCT e.id, e.nombre, e.nombre_corto, e.slug, e.admin_email
  FROM empresas_afectadas e;
END;
$$;


--
-- Name: vencer_trials_expirados(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vencer_trials_expirados() RETURNS TABLE(empresa_id uuid, plan_anterior text, accion text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  r RECORD;
  nueva_susc_id UUID;
BEGIN
  FOR r IN
    SELECT s.id AS susc_id, s.empresa_id AS eid, s.plan AS plan_actual
    FROM suscripciones s
    WHERE s.estado = 'trial'
      AND s.trial_fin IS NOT NULL
      AND s.trial_fin < NOW()
  LOOP
    -- Marcar suscripción de trial como vencida
    UPDATE suscripciones SET estado = 'vencida' WHERE id = r.susc_id;

    -- Crear nueva suscripción Free para la empresa
    INSERT INTO suscripciones (empresa_id, plan, estado, periodo_inicio, precio, moneda, gateway)
    VALUES (r.eid, 'free', 'activa', NOW(), 0, 'ARS', 'manual')
    RETURNING id INTO nueva_susc_id;

    -- Actualizar cache en empresa
    UPDATE empresa
    SET plan_activo = 'free',
        trial_usado = TRUE,
        suscripcion_activa_id = nueva_susc_id
    WHERE id = r.eid;

    empresa_id := r.eid;
    plan_anterior := r.plan_actual;
    accion := 'trial_vencido_bajado_a_free';
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    empresa_id uuid,
    actor_id uuid,
    actor_legajo integer,
    actor_rol text,
    accion text NOT NULL,
    entidad text,
    entidad_id text,
    datos_antes jsonb,
    datos_despues jsonb,
    ip text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: config_sistema; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_sistema (
    clave text NOT NULL,
    valor jsonb DEFAULT '{}'::jsonb NOT NULL,
    empresa_id uuid NOT NULL
);


--
-- Name: cron_ejecuciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_ejecuciones (
    nombre text NOT NULL,
    ultima_corrida timestamp with time zone,
    ultima_ok timestamp with time zone,
    ultimo_error text,
    duracion_ms integer
);


--
-- Name: divisiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.divisiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    clave text NOT NULL,
    label text NOT NULL,
    icon text DEFAULT '📦'::text,
    color text DEFAULT '#F97316'::text,
    orden integer DEFAULT 0,
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: documentos_empleado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_empleado (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    empleado_id uuid NOT NULL,
    tipo_documento_id uuid NOT NULL,
    storage_path text NOT NULL,
    nombre_archivo text,
    mime_type text,
    tamano_bytes integer,
    estado text DEFAULT 'cargado'::text NOT NULL,
    fecha_carga timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documentos_empleado_estado_check CHECK ((estado = ANY (ARRAY['cargado'::text, 'rechazado'::text, 'vencido'::text])))
);


--
-- Name: documentos_exigidos_empleado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_exigidos_empleado (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    empleado_id uuid NOT NULL,
    tipo_documento_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_eventos (
    id bigint NOT NULL,
    resend_email_id text,
    tipo_email text,
    evento text NOT NULL,
    empresa_id uuid,
    destinatario text,
    link text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE email_eventos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_eventos IS 'Eventos del webhook de Resend (sent/delivered/opened/clicked/bounced/complained). Solo server-side.';


--
-- Name: email_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.email_eventos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.email_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: empleados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empleados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legajo integer NOT NULL,
    nombre text NOT NULL,
    apodo text NOT NULL,
    email text,
    rol text NOT NULL,
    area text NOT NULL,
    cc text DEFAULT 'GENERAL'::text,
    diagrama jsonb,
    horas_semanales numeric DEFAULT 41,
    activo boolean DEFAULT true,
    auth_user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    division text,
    password text,
    debe_cambiar_password boolean DEFAULT true,
    empresa_id uuid NOT NULL,
    estado_activacion text DEFAULT 'activo'::text,
    dni text,
    password_reset_jti text,
    geo_config jsonb DEFAULT '{"radio": 150, "activo": false, "ubicacion_id": null}'::jsonb,
    pre_cargado boolean DEFAULT false,
    google_id text,
    activacion_codigo_hash text,
    activacion_expira timestamp with time zone,
    CONSTRAINT empleados_rol_check CHECK ((rol = ANY (ARRAY['operativo'::text, 'gerencial'::text, 'administrativo'::text])))
);


--
-- Name: COLUMN empleados.division; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empleados.division IS 'División del taller: herreria, muebles, o aberturas';


--
-- Name: empresa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresa (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text DEFAULT 'Mi Empresa'::text NOT NULL,
    nombre_corto text DEFAULT 'App'::text NOT NULL,
    logo_url text,
    color_primario text DEFAULT '#F97316'::text NOT NULL,
    color_secundario text DEFAULT '#8B5CF6'::text NOT NULL,
    rubro text DEFAULT 'general'::text,
    prompt_ia_obra text DEFAULT 'Sos un asistente de obra. Tu trabajo es interpretar el reporte oral/escrito de un instalador y devolver SOLO un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:
{
  "progreso": "Resumen claro del avance efectivo del día",
  "faltantes": ["lista de materiales o cosas que faltaron"],
  "desvios": ["lista de imprevistos, esperas o desvíos"],
  "mensaje_doble_check": "Frase amigable resumiendo lo que entendiste para que el instalador confirme. Ej: Entendí que montaron X pero faltó Y. ¿Es correcto?"
}
Si algo no se menciona, dejá el array vacío o string vacío. Siempre respondé SOLO el JSON.'::text NOT NULL,
    prompt_ia_chat text DEFAULT 'Sos un asistente de RRHH amigable. Respondés en español argentino, tuteo. Sos conciso y útil. Podés ayudar con fichadas, permisos, horarios y consultas laborales.'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    admin_email text,
    admin_password text,
    plan text DEFAULT 'free'::text NOT NULL,
    max_empleados integer DEFAULT 10 NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    slug text,
    tema_fondo text DEFAULT 'oscuro'::text,
    color_fondo text DEFAULT '#0C0A09'::text,
    color_texto text DEFAULT '#F5F0E8'::text,
    tipografia text DEFAULT 'default'::text,
    formato_hora text DEFAULT '24h'::text,
    sonido_notif boolean DEFAULT true,
    resumen_diario boolean DEFAULT false,
    minutos_almuerzo integer DEFAULT 60,
    horas_jornada_habitual numeric DEFAULT 9,
    config_fichaje jsonb DEFAULT '{"minutos_almuerzo": 60, "horas_jornada_habitual": 9, "tolerancia_tardanza_min": 30, "horas_extras_sabado_desde": "13:00", "max_tardanzas_presentismo": 3, "auto_fichaje_horas_despues": 4, "horas_extras_domingo_completo": true}'::jsonb,
    empresa_id uuid,
    onboarding_completado boolean DEFAULT false,
    plan_activo text DEFAULT 'free'::text,
    trial_usado boolean DEFAULT false,
    suscripcion_activa_id uuid,
    typography text DEFAULT 'system'::text,
    theme_preset text DEFAULT 'default'::text,
    timezone text DEFAULT 'America/Argentina/Buenos_Aires'::text,
    email_verificado boolean DEFAULT true,
    email_verify_token text,
    email_verify_expires timestamp with time zone,
    plan_vence timestamp with time zone,
    plan_override_manual boolean DEFAULT false NOT NULL,
    limite_excedido_desde timestamp with time zone,
    eliminacion_solicitada timestamp with time zone,
    eliminacion_solicitada_por text,
    reglas_asistencia jsonb DEFAULT '{"bloqueo_min": null, "tolerancia_min": 5, "bloqueo_tardanzas_mes": null}'::jsonb NOT NULL,
    CONSTRAINT empresa_theme_preset_check CHECK ((theme_preset = ANY (ARRAY['default'::text, 'crema'::text, 'hielo'::text, 'menta'::text, 'oscuro'::text, 'carbon'::text, 'medianoche'::text, 'industrial'::text, 'custom'::text])))
);


--
-- Name: COLUMN empresa.limite_excedido_desde; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresa.limite_excedido_desde IS 'Momento en que la empresa superó el tope de empleados de su plan. NULL = dentro del límite. El bloqueo del excedente arranca a los 7 días (ver DIAS_GRACIA en app/lib/limiteEmpleados.js). Lo setea y lo limpia el cron /api/cron/limite-empleados.';


--
-- Name: COLUMN empresa.eliminacion_solicitada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresa.eliminacion_solicitada IS 'Momento en que el administrador pidió la baja. NULL = cuenta vigente. La eliminación efectiva ocurre 30 días después (ver /api/cron/purgar-empresas). Se puede cancelar poniéndolo en NULL.';


--
-- Name: COLUMN empresa.eliminacion_solicitada_por; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.empresa.eliminacion_solicitada_por IS 'empleado_id del administrador que pidió la baja, para auditoría.';


--
-- Name: etapas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etapas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    codigo integer NOT NULL,
    nombre text NOT NULL,
    icon text DEFAULT '🔨'::text,
    color text DEFAULT '#F97316'::text,
    orden integer DEFAULT 0,
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: fichadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fichadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleado_id uuid NOT NULL,
    legajo integer NOT NULL,
    fecha date DEFAULT CURRENT_DATE,
    ingreso time without time zone,
    egreso time without time zone,
    horas_trabajadas numeric,
    tardanza_no_avisada boolean DEFAULT false,
    horas_extra boolean DEFAULT false,
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    geo_ingreso jsonb,
    geo_egreso jsonb,
    llegada_tarde boolean DEFAULT false,
    minutos_tarde integer DEFAULT 0,
    egreso_auto boolean DEFAULT false,
    empresa_id uuid NOT NULL,
    horas_extras numeric,
    permiso_ingreso boolean DEFAULT false,
    auto_fichaje boolean DEFAULT false,
    minutos_almuerzo integer DEFAULT 0,
    egreso_automatico boolean DEFAULT false
);


--
-- Name: geo_registros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_registros (
    id bigint NOT NULL,
    empresa_id uuid NOT NULL,
    empleado_id uuid,
    fichada_id uuid,
    lat numeric,
    lng numeric,
    distancia numeric,
    accion text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: geo_registros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geo_registros_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geo_registros_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geo_registros_id_seq OWNED BY public.geo_registros.id;


--
-- Name: geo_zonas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_zonas (
    id bigint NOT NULL,
    empresa_id uuid NOT NULL,
    nombre text NOT NULL,
    lat numeric NOT NULL,
    lng numeric NOT NULL,
    radio integer DEFAULT 150,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: geo_zonas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geo_zonas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geo_zonas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geo_zonas_id_seq OWNED BY public.geo_zonas.id;


--
-- Name: invitaciones_empresa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitaciones_empresa (
    id bigint NOT NULL,
    empresa_id uuid NOT NULL,
    codigo text NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: invitaciones_empresa_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invitaciones_empresa_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invitaciones_empresa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invitaciones_empresa_id_seq OWNED BY public.invitaciones_empresa.id;


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    ip text NOT NULL,
    ventana text NOT NULL,
    count integer DEFAULT 1 NOT NULL
);


--
-- Name: mensajes_chat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensajes_chat (
    id integer NOT NULL,
    legajo integer NOT NULL,
    rol text NOT NULL,
    mensaje text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    empresa_id uuid NOT NULL,
    CONSTRAINT mensajes_chat_rol_check CHECK ((rol = ANY (ARRAY['user'::text, 'bot'::text])))
);


--
-- Name: mensajes_chat_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mensajes_chat_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mensajes_chat_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mensajes_chat_id_seq OWNED BY public.mensajes_chat.id;


--
-- Name: metricas_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metricas_eventos (
    id bigint NOT NULL,
    evento text NOT NULL,
    empresa_id uuid,
    empleado_id uuid,
    plan text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE metricas_eventos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.metricas_eventos IS 'Eventos de tracking SaaS: registro, onboarding, fichaje, upgrade, churn. Solo server-side.';


--
-- Name: metricas_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.metricas_eventos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.metricas_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notas_calendario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_calendario (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fecha date NOT NULL,
    empleado_id uuid,
    texto text NOT NULL,
    color text DEFAULT '#F97316'::text,
    created_at timestamp with time zone DEFAULT now(),
    empresa_id uuid NOT NULL
);


--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id integer NOT NULL,
    destinatario_rol text NOT NULL,
    tipo text DEFAULT 'info'::text,
    asunto text NOT NULL,
    detalle text,
    urgencia text DEFAULT 'normal'::text,
    leida boolean DEFAULT false,
    solicitud_id integer,
    created_at timestamp with time zone DEFAULT now(),
    empresa_id uuid NOT NULL,
    CONSTRAINT notificaciones_urgencia_check CHECK ((urgencia = ANY (ARRAY['baja'::text, 'normal'::text, 'alta'::text])))
);


--
-- Name: notificaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notificaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificaciones_id_seq OWNED BY public.notificaciones.id;


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    suscripcion_id uuid,
    monto numeric(12,2) NOT NULL,
    moneda text DEFAULT 'ARS'::text,
    estado text NOT NULL,
    gateway text,
    gateway_payment_id text,
    fecha_pago timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    cae text,
    cae_vencimiento date,
    numero_comprobante integer,
    punto_venta integer,
    tipo_comprobante integer,
    factura_error text,
    CONSTRAINT pagos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text, 'reembolsado'::text]))),
    CONSTRAINT pagos_gateway_check CHECK ((gateway = ANY (ARRAY['mercadopago'::text, 'stripe'::text, 'manual'::text]))),
    CONSTRAINT pagos_moneda_check CHECK ((moneda = ANY (ARRAY['ARS'::text, 'USD'::text])))
);


--
-- Name: proyectos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proyectos (
    id bigint NOT NULL,
    empresa_id uuid NOT NULL,
    ot text NOT NULL,
    cliente text,
    obra text,
    proyecto text,
    division text,
    estado text DEFAULT 'activo'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proyectos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proyectos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proyectos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proyectos_id_seq OWNED BY public.proyectos.id;


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legajo text NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    empresa_id uuid
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    empresa_id uuid NOT NULL,
    ventana text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: registro_actividades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registro_actividades (
    id bigint NOT NULL,
    empleado_id uuid NOT NULL,
    legajo text NOT NULL,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    hora_inicio timestamp with time zone NOT NULL,
    hora_fin timestamp with time zone,
    codigo_proyecto text,
    etapa smallint NOT NULL,
    tipo character(1) DEFAULT 'N'::bpchar NOT NULL,
    causa character(1),
    division text NOT NULL,
    duracion_min numeric(7,2),
    observaciones text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    empresa_id uuid,
    CONSTRAINT chk_causa CHECK (((causa IS NULL) OR (causa = ANY (ARRAY['M'::bpchar, 'H'::bpchar, 'I'::bpchar, 'O'::bpchar])))),
    CONSTRAINT chk_causa_etapa CHECK ((((etapa = 0) AND (causa IS NOT NULL)) OR ((etapa > 0) AND (causa IS NULL)))),
    CONSTRAINT chk_division CHECK ((division = ANY (ARRAY['herreria'::text, 'muebles'::text, 'aberturas'::text]))),
    CONSTRAINT chk_duracion CHECK (((duracion_min IS NULL) OR (duracion_min >= (0)::numeric))),
    CONSTRAINT chk_etapa CHECK (((etapa >= 0) AND (etapa <= 8))),
    CONSTRAINT chk_proyecto_etapa CHECK ((((etapa = 0) AND (codigo_proyecto IS NULL)) OR ((etapa > 0) AND (codigo_proyecto IS NOT NULL)))),
    CONSTRAINT chk_tipo CHECK ((tipo = ANY (ARRAY['N'::bpchar, 'R'::bpchar, 'E'::bpchar, 'C'::bpchar])))
);


--
-- Name: TABLE registro_actividades; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.registro_actividades IS 'Cada fila = un tramo continuo de trabajo o espera de un operario.';


--
-- Name: registro_actividades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.registro_actividades ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.registro_actividades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reglas_bot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reglas_bot (
    id integer NOT NULL,
    regla text NOT NULL,
    activa boolean DEFAULT true,
    creada_por text DEFAULT 'sistema'::text,
    created_at timestamp with time zone DEFAULT now(),
    empresa_id uuid NOT NULL
);


--
-- Name: reglas_bot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reglas_bot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reglas_bot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reglas_bot_id_seq OWNED BY public.reglas_bot.id;


--
-- Name: reportes_obra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reportes_obra (
    id bigint NOT NULL,
    usuario_id uuid,
    nombre text NOT NULL,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    texto_original text,
    progreso text,
    faltantes jsonb DEFAULT '[]'::jsonb,
    desvios jsonb DEFAULT '[]'::jsonb,
    fotos integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    fotos_urls jsonb DEFAULT '[]'::jsonb,
    empresa_id uuid NOT NULL,
    legajo numeric,
    participantes text[] DEFAULT '{}'::text[],
    reportado_por text
);


--
-- Name: reportes_obra_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reportes_obra_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reportes_obra_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reportes_obra_id_seq OWNED BY public.reportes_obra.id;


--
-- Name: sesiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleado_id uuid,
    legajo text NOT NULL,
    empresa_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    revocada boolean DEFAULT false,
    device_info text,
    jti text,
    refresh_jti text,
    expira_en timestamp with time zone DEFAULT (now() + '30 days'::interval),
    token text
);


--
-- Name: solicitudes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitudes (
    id integer NOT NULL,
    empleado_id uuid NOT NULL,
    legajo integer NOT NULL,
    nombre_empleado text NOT NULL,
    tipo text NOT NULL,
    motivo text NOT NULL,
    fecha date,
    desde text,
    hasta text,
    horas numeric DEFAULT 0,
    estado text DEFAULT 'pendiente'::text,
    aprobador text,
    resuelto_at timestamp with time zone,
    notas_gerencia text,
    created_at timestamp with time zone DEFAULT now(),
    empresa_id uuid NOT NULL,
    CONSTRAINT solicitudes_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text, 'registrado'::text]))),
    CONSTRAINT solicitudes_tipo_check CHECK ((tipo = ANY (ARRAY['permiso'::text, 'aviso'::text, 'vacaciones'::text, 'ausencia'::text, 'tardanza'::text, 'justificacion'::text, 'cambio_horario'::text, 'hora_extra'::text, 'salida_anticipada'::text, 'otro'::text])))
);


--
-- Name: solicitudes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitudes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitudes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitudes_id_seq OWNED BY public.solicitudes.id;


--
-- Name: suscripciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suscripciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    plan text NOT NULL,
    estado text NOT NULL,
    trial_inicio timestamp with time zone,
    trial_fin timestamp with time zone,
    periodo_inicio timestamp with time zone,
    periodo_fin timestamp with time zone,
    precio numeric(12,2) DEFAULT 0,
    moneda text DEFAULT 'ARS'::text,
    gateway text,
    gateway_subscription_id text,
    gateway_customer_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT suscripciones_estado_check CHECK ((estado = ANY (ARRAY['trial'::text, 'activa'::text, 'vencida'::text, 'suspendida'::text, 'cancelada'::text]))),
    CONSTRAINT suscripciones_gateway_check CHECK ((gateway = ANY (ARRAY['mercadopago'::text, 'stripe'::text, 'manual'::text]))),
    CONSTRAINT suscripciones_moneda_check CHECK ((moneda = ANY (ARRAY['ARS'::text, 'USD'::text]))),
    CONSTRAINT suscripciones_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'enterprise'::text])))
);


--
-- Name: tipos_documento_requerido; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipos_documento_requerido (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empresa_id uuid NOT NULL,
    nombre text NOT NULL,
    formatos_aceptados text[] DEFAULT ARRAY['pdf'::text, 'image'::text] NOT NULL,
    admite_multiples boolean DEFAULT false NOT NULL,
    tipo_carga text DEFAULT 'puntual'::text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tipos_documento_requerido_tipo_carga_check CHECK ((tipo_carga = ANY (ARRAY['puntual'::text, 'recurrente'::text])))
);


--
-- Name: turnos_planificados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.turnos_planificados (
    id bigint NOT NULL,
    empresa_id uuid NOT NULL,
    empleado_id uuid NOT NULL,
    fecha date NOT NULL,
    hora_inicio time without time zone NOT NULL,
    hora_fin time without time zone NOT NULL,
    proyecto_id bigint,
    nota text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: turnos_planificados_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.turnos_planificados_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: turnos_planificados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.turnos_planificados_id_seq OWNED BY public.turnos_planificados.id;


--
-- Name: v_resumen_diario; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_resumen_diario AS
 SELECT e.empresa_id,
    COALESCE(f.fecha, ra_agg.fecha, CURRENT_DATE) AS fecha,
    e.id AS empleado_id,
    e.legajo,
    e.nombre AS empleado_nombre,
    e.division,
    f.ingreso,
    f.egreso,
    f.horas_trabajadas,
    f.llegada_tarde,
    f.minutos_tarde,
    ra_agg.etapa_actual,
    ra_agg.proyecto_actual,
    ra_agg.tarea_inicio,
    ra_agg.minutos_productivos,
    ra_agg.minutos_espera,
        CASE
            WHEN ((COALESCE(ra_agg.minutos_productivos, (0)::numeric) + COALESCE(ra_agg.minutos_espera, (0)::numeric)) > (0)::numeric) THEN round(((ra_agg.minutos_productivos * 100.0) / (ra_agg.minutos_productivos + ra_agg.minutos_espera)), 1)
            ELSE (0)::numeric
        END AS pct_productivo,
    ra_agg.tareas_completadas,
    ra_agg.causa_espera
   FROM ((public.empleados e
     LEFT JOIN public.fichadas f ON (((f.legajo = e.legajo) AND (f.fecha = CURRENT_DATE))))
     LEFT JOIN LATERAL ( SELECT ra_fecha.fecha,
            ra_activa.etapa AS etapa_actual,
            ra_activa.codigo_proyecto AS proyecto_actual,
            ra_activa.hora_inicio AS tarea_inicio,
            ra_activa.causa AS causa_espera,
            COALESCE(( SELECT sum(registro_actividades.duracion_min) AS sum
                   FROM public.registro_actividades
                  WHERE ((registro_actividades.empleado_id = e.id) AND (registro_actividades.fecha = CURRENT_DATE) AND (registro_actividades.hora_fin IS NOT NULL) AND (registro_actividades.etapa > 0))), (0)::numeric) AS minutos_productivos,
            COALESCE(( SELECT sum(registro_actividades.duracion_min) AS sum
                   FROM public.registro_actividades
                  WHERE ((registro_actividades.empleado_id = e.id) AND (registro_actividades.fecha = CURRENT_DATE) AND (registro_actividades.hora_fin IS NOT NULL) AND (registro_actividades.etapa = 0))), (0)::numeric) AS minutos_espera,
            (COALESCE(( SELECT count(*) AS count
                   FROM public.registro_actividades
                  WHERE ((registro_actividades.empleado_id = e.id) AND (registro_actividades.fecha = CURRENT_DATE) AND (registro_actividades.hora_fin IS NOT NULL))), (0)::bigint))::integer AS tareas_completadas
           FROM (( SELECT CURRENT_DATE AS fecha) ra_fecha
             LEFT JOIN LATERAL ( SELECT registro_actividades.etapa,
                    registro_actividades.codigo_proyecto,
                    registro_actividades.hora_inicio,
                    registro_actividades.causa
                   FROM public.registro_actividades
                  WHERE ((registro_actividades.empleado_id = e.id) AND (registro_actividades.hora_fin IS NULL))
                  ORDER BY registro_actividades.hora_inicio DESC
                 LIMIT 1) ra_activa ON (true))) ra_agg ON (true))
  WHERE (e.activo = true);


--
-- Name: v_scores_empleados; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_scores_empleados AS
 WITH periodo AS (
         SELECT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date AS inicio,
            CURRENT_DATE AS fin,
            GREATEST(1, (EXTRACT(day FROM CURRENT_DATE))::integer) AS dias_mes
        ), fichadas_mes AS (
         SELECT f_1.legajo,
            f_1.empresa_id,
            (count(*))::integer AS dias_fichados,
            (sum(
                CASE
                    WHEN f_1.llegada_tarde THEN 1
                    ELSE 0
                END))::integer AS tardanzas,
            COALESCE(sum(f_1.horas_trabajadas), (0)::numeric) AS horas_trabajadas
           FROM public.fichadas f_1,
            periodo p
          WHERE ((f_1.fecha >= p.inicio) AND (f_1.fecha <= p.fin))
          GROUP BY f_1.legajo, f_1.empresa_id
        ), solicitudes_mes AS (
         SELECT s_1.legajo,
            s_1.empresa_id,
            (count(*))::integer AS total_solicitudes
           FROM public.solicitudes s_1,
            periodo p
          WHERE (s_1.created_at >= p.inicio)
          GROUP BY s_1.legajo, s_1.empresa_id
        ), actividad_mes AS (
         SELECT a_1.empleado_id,
            a_1.empresa_id,
            COALESCE(sum(
                CASE
                    WHEN (a_1.etapa > 0) THEN a_1.duracion_min
                    ELSE (0)::numeric
                END), (0)::numeric) AS min_productivos,
            COALESCE(sum(
                CASE
                    WHEN (a_1.etapa = 0) THEN a_1.duracion_min
                    ELSE (0)::numeric
                END), (0)::numeric) AS min_espera
           FROM public.registro_actividades a_1,
            periodo p
          WHERE ((a_1.fecha >= p.inicio) AND (a_1.hora_fin IS NOT NULL))
          GROUP BY a_1.empleado_id, a_1.empresa_id
        )
 SELECT e.id AS empleado_id,
    e.empresa_id,
    e.nombre,
    e.apodo,
    e.legajo,
    e.division,
    COALESCE(f.dias_fichados, 0) AS dias_fichados,
    COALESCE(f.tardanzas, 0) AS tardanzas,
    round(COALESCE(f.horas_trabajadas, (0)::numeric), 1) AS horas_trabajadas,
    COALESCE(s.total_solicitudes, 0) AS solicitudes_mes,
    round(COALESCE(a.min_productivos, (0)::numeric)) AS min_productivos,
    round(COALESCE(a.min_espera, (0)::numeric)) AS min_espera,
    round((((((
        CASE
            WHEN (COALESCE(f.dias_fichados, 0) > 0) THEN ((1.0)::double precision - ((COALESCE(f.tardanzas, 0))::double precision / (f.dias_fichados)::double precision))
            ELSE (0.5)::double precision
        END * (35)::double precision) + (
        CASE
            WHEN ((COALESCE(a.min_productivos, (0)::numeric) + COALESCE(a.min_espera, (0)::numeric)) > (0)::numeric) THEN ((COALESCE(a.min_productivos, (0)::numeric))::double precision / ((COALESCE(a.min_productivos, (0)::numeric) + COALESCE(a.min_espera, (0)::numeric)))::double precision)
            ELSE (0.5)::double precision
        END * (30)::double precision)) + (LEAST((1.0)::double precision, ((COALESCE(f.horas_trabajadas, (0)::numeric))::double precision / (160.0)::double precision)) * (25)::double precision)) + (GREATEST((0.0)::double precision, ((1.0)::double precision - ((COALESCE(s.total_solicitudes, 0))::double precision / (5.0)::double precision))) * (10)::double precision)))::numeric, 1) AS score_em,
    round((((((
        CASE
            WHEN (COALESCE(f.dias_fichados, 0) > 0) THEN ((COALESCE(f.tardanzas, 0))::double precision / (f.dias_fichados)::double precision)
            ELSE (0.0)::double precision
        END * (40)::double precision) + (
        CASE
            WHEN ((COALESCE(a.min_productivos, (0)::numeric) + COALESCE(a.min_espera, (0)::numeric)) > (0)::numeric) THEN ((COALESCE(a.min_espera, (0)::numeric))::double precision / ((COALESCE(a.min_productivos, (0)::numeric) + COALESCE(a.min_espera, (0)::numeric)))::double precision)
            ELSE (0.0)::double precision
        END * (30)::double precision)) + (GREATEST((0.0)::double precision, ((1.0)::double precision - ((COALESCE(f.dias_fichados, 0))::double precision / (LEAST(( SELECT periodo.dias_mes
           FROM periodo), 22))::double precision))) * (20)::double precision)) + (LEAST((1.0)::double precision, ((COALESCE(s.total_solicitudes, 0))::double precision / (5.0)::double precision)) * (10)::double precision)))::numeric, 1) AS score_nc
   FROM (((public.empleados e
     LEFT JOIN fichadas_mes f ON (((f.legajo = e.legajo) AND (f.empresa_id = e.empresa_id))))
     LEFT JOIN solicitudes_mes s ON (((s.legajo = e.legajo) AND (s.empresa_id = e.empresa_id))))
     LEFT JOIN actividad_mes a ON (((a.empleado_id = e.id) AND (a.empresa_id = e.empresa_id))))
  WHERE (e.activo = true);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: geo_registros id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_registros ALTER COLUMN id SET DEFAULT nextval('public.geo_registros_id_seq'::regclass);


--
-- Name: geo_zonas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_zonas ALTER COLUMN id SET DEFAULT nextval('public.geo_zonas_id_seq'::regclass);


--
-- Name: invitaciones_empresa id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitaciones_empresa ALTER COLUMN id SET DEFAULT nextval('public.invitaciones_empresa_id_seq'::regclass);


--
-- Name: mensajes_chat id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_chat ALTER COLUMN id SET DEFAULT nextval('public.mensajes_chat_id_seq'::regclass);


--
-- Name: notificaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id SET DEFAULT nextval('public.notificaciones_id_seq'::regclass);


--
-- Name: proyectos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proyectos ALTER COLUMN id SET DEFAULT nextval('public.proyectos_id_seq'::regclass);


--
-- Name: reglas_bot id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reglas_bot ALTER COLUMN id SET DEFAULT nextval('public.reglas_bot_id_seq'::regclass);


--
-- Name: reportes_obra id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_obra ALTER COLUMN id SET DEFAULT nextval('public.reportes_obra_id_seq'::regclass);


--
-- Name: solicitudes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes ALTER COLUMN id SET DEFAULT nextval('public.solicitudes_id_seq'::regclass);


--
-- Name: turnos_planificados id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados ALTER COLUMN id SET DEFAULT nextval('public.turnos_planificados_id_seq'::regclass);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: config_sistema config_sistema_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_sistema
    ADD CONSTRAINT config_sistema_pkey PRIMARY KEY (clave);


--
-- Name: cron_ejecuciones cron_ejecuciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_ejecuciones
    ADD CONSTRAINT cron_ejecuciones_pkey PRIMARY KEY (nombre);


--
-- Name: divisiones divisiones_empresa_id_clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divisiones
    ADD CONSTRAINT divisiones_empresa_id_clave_key UNIQUE (empresa_id, clave);


--
-- Name: divisiones divisiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divisiones
    ADD CONSTRAINT divisiones_pkey PRIMARY KEY (id);


--
-- Name: documentos_empleado documentos_empleado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_empleado
    ADD CONSTRAINT documentos_empleado_pkey PRIMARY KEY (id);


--
-- Name: documentos_exigidos_empleado documentos_exigidos_empleado_empleado_id_tipo_documento_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_exigidos_empleado
    ADD CONSTRAINT documentos_exigidos_empleado_empleado_id_tipo_documento_id_key UNIQUE (empleado_id, tipo_documento_id);


--
-- Name: documentos_exigidos_empleado documentos_exigidos_empleado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_exigidos_empleado
    ADD CONSTRAINT documentos_exigidos_empleado_pkey PRIMARY KEY (id);


--
-- Name: email_eventos email_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_eventos
    ADD CONSTRAINT email_eventos_pkey PRIMARY KEY (id);


--
-- Name: empleados empleados_empresa_legajo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_empresa_legajo_key UNIQUE (empresa_id, legajo);


--
-- Name: empleados empleados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_pkey PRIMARY KEY (id);


--
-- Name: empresa empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa
    ADD CONSTRAINT empresa_pkey PRIMARY KEY (id);


--
-- Name: empresa empresa_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa
    ADD CONSTRAINT empresa_slug_key UNIQUE (slug);


--
-- Name: etapas etapas_empresa_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas
    ADD CONSTRAINT etapas_empresa_id_codigo_key UNIQUE (empresa_id, codigo);


--
-- Name: etapas etapas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas
    ADD CONSTRAINT etapas_pkey PRIMARY KEY (id);


--
-- Name: fichadas fichadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichadas
    ADD CONSTRAINT fichadas_pkey PRIMARY KEY (id);


--
-- Name: geo_registros geo_registros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_registros
    ADD CONSTRAINT geo_registros_pkey PRIMARY KEY (id);


--
-- Name: geo_zonas geo_zonas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_zonas
    ADD CONSTRAINT geo_zonas_pkey PRIMARY KEY (id);


--
-- Name: invitaciones_empresa invitaciones_empresa_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitaciones_empresa
    ADD CONSTRAINT invitaciones_empresa_codigo_key UNIQUE (codigo);


--
-- Name: invitaciones_empresa invitaciones_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitaciones_empresa
    ADD CONSTRAINT invitaciones_empresa_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (ip, ventana);


--
-- Name: mensajes_chat mensajes_chat_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_chat
    ADD CONSTRAINT mensajes_chat_pkey PRIMARY KEY (id);


--
-- Name: metricas_eventos metricas_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_eventos
    ADD CONSTRAINT metricas_eventos_pkey PRIMARY KEY (id);


--
-- Name: notas_calendario notas_calendario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_calendario
    ADD CONSTRAINT notas_calendario_pkey PRIMARY KEY (id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_gateway_payment_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_gateway_payment_id_unique UNIQUE (gateway_payment_id);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: proyectos proyectos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proyectos
    ADD CONSTRAINT proyectos_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_legajo_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_legajo_token_key UNIQUE (legajo, token);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (empresa_id, ventana);


--
-- Name: registro_actividades registro_actividades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registro_actividades
    ADD CONSTRAINT registro_actividades_pkey PRIMARY KEY (id);


--
-- Name: reglas_bot reglas_bot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reglas_bot
    ADD CONSTRAINT reglas_bot_pkey PRIMARY KEY (id);


--
-- Name: reportes_obra reportes_obra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_obra
    ADD CONSTRAINT reportes_obra_pkey PRIMARY KEY (id);


--
-- Name: sesiones sesiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_pkey PRIMARY KEY (id);


--
-- Name: solicitudes solicitudes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_pkey PRIMARY KEY (id);


--
-- Name: suscripciones suscripciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_pkey PRIMARY KEY (id);


--
-- Name: tipos_documento_requerido tipos_documento_requerido_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_documento_requerido
    ADD CONSTRAINT tipos_documento_requerido_pkey PRIMARY KEY (id);


--
-- Name: turnos_planificados turnos_planificados_empresa_id_empleado_id_fecha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados
    ADD CONSTRAINT turnos_planificados_empresa_id_empleado_id_fecha_key UNIQUE (empresa_id, empleado_id, fecha);


--
-- Name: turnos_planificados turnos_planificados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados
    ADD CONSTRAINT turnos_planificados_pkey PRIMARY KEY (id);


--
-- Name: proyectos uq_proyectos; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proyectos
    ADD CONSTRAINT uq_proyectos UNIQUE (empresa_id, ot);


--
-- Name: empleados_activacion_codigo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX empleados_activacion_codigo_idx ON public.empleados USING btree (empresa_id, activacion_codigo_hash) WHERE (activacion_codigo_hash IS NOT NULL);


--
-- Name: empleados_empresa_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleados_empresa_email_uq ON public.empleados USING btree (empresa_id, lower(email)) WHERE (email IS NOT NULL);


--
-- Name: empresa_admin_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empresa_admin_email_uq ON public.empresa USING btree (lower(admin_email)) WHERE (admin_email IS NOT NULL);


--
-- Name: empresa_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empresa_slug_unique ON public.empresa USING btree (lower(slug)) WHERE (slug IS NOT NULL);


--
-- Name: fichadas_empresa_empleado_fecha_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fichadas_empresa_empleado_fecha_uq ON public.fichadas USING btree (empresa_id, empleado_id, fecha);


--
-- Name: idx_actividad_activa_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividad_activa_empresa ON public.registro_actividades USING btree (empleado_id, empresa_id) WHERE (hora_fin IS NULL);


--
-- Name: idx_actividades_activas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividades_activas ON public.registro_actividades USING btree (empleado_id) WHERE (hora_fin IS NULL);


--
-- Name: idx_actividades_division_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividades_division_fecha ON public.registro_actividades USING btree (division, fecha DESC);


--
-- Name: idx_actividades_empleado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividades_empleado_fecha ON public.registro_actividades USING btree (empleado_id, fecha DESC);


--
-- Name: idx_actividades_fecha_division; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actividades_fecha_division ON public.registro_actividades USING btree (fecha DESC, division);


--
-- Name: idx_audit_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_id, created_at DESC);


--
-- Name: idx_audit_log_empresa_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_empresa_time ON public.audit_log USING btree (empresa_id, created_at DESC);


--
-- Name: idx_audit_log_impersonate_exchange_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_audit_log_impersonate_exchange_jti ON public.audit_log USING btree (entidad_id) WHERE (accion = 'impersonate_exchange'::text);


--
-- Name: idx_audit_log_oauth_exchange_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_audit_log_oauth_exchange_jti ON public.audit_log USING btree (entidad_id) WHERE (accion = 'oauth_exchange'::text);


--
-- Name: idx_doc_empleado_empleado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_empleado_empleado ON public.documentos_empleado USING btree (empleado_id, tipo_documento_id);


--
-- Name: idx_doc_empleado_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_empleado_empresa ON public.documentos_empleado USING btree (empresa_id);


--
-- Name: idx_doc_exigidos_empleado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_exigidos_empleado ON public.documentos_exigidos_empleado USING btree (empleado_id);


--
-- Name: idx_doc_exigidos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_exigidos_empresa ON public.documentos_exigidos_empleado USING btree (empresa_id);


--
-- Name: idx_email_eventos_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_eventos_created ON public.email_eventos USING btree (created_at);


--
-- Name: idx_email_eventos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_eventos_empresa ON public.email_eventos USING btree (empresa_id) WHERE (empresa_id IS NOT NULL);


--
-- Name: idx_email_eventos_tipo_evt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_eventos_tipo_evt ON public.email_eventos USING btree (tipo_email, evento);


--
-- Name: idx_empleados_dni; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleados_dni ON public.empleados USING btree (empresa_id, dni);


--
-- Name: idx_empleados_email_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleados_email_empresa ON public.empleados USING btree (empresa_id, lower(email)) WHERE ((activo = true) AND (email IS NOT NULL));


--
-- Name: idx_empleados_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleados_empresa ON public.empleados USING btree (empresa_id);


--
-- Name: idx_empleados_empresa_google_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_empleados_empresa_google_id ON public.empleados USING btree (empresa_id, google_id) WHERE (google_id IS NOT NULL);


--
-- Name: idx_empleados_legajo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleados_legajo ON public.empleados USING btree (legajo);


--
-- Name: idx_empresa_eliminacion_solicitada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresa_eliminacion_solicitada ON public.empresa USING btree (eliminacion_solicitada) WHERE (eliminacion_solicitada IS NOT NULL);


--
-- Name: idx_empresa_limite_excedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresa_limite_excedido ON public.empresa USING btree (limite_excedido_desde) WHERE (limite_excedido_desde IS NOT NULL);


--
-- Name: idx_empresa_plan_vence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresa_plan_vence ON public.empresa USING btree (plan_vence) WHERE (plan_vence IS NOT NULL);


--
-- Name: idx_empresa_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresa_slug ON public.empresa USING btree (slug);


--
-- Name: idx_empresa_verify_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresa_verify_token ON public.empresa USING btree (email_verify_token) WHERE (email_verify_token IS NOT NULL);


--
-- Name: idx_fichadas_egreso_pendiente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_egreso_pendiente ON public.fichadas USING btree (empleado_id, fecha DESC) WHERE (egreso IS NULL);


--
-- Name: idx_fichadas_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_empresa ON public.fichadas USING btree (empresa_id);


--
-- Name: idx_fichadas_empresa_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_empresa_fecha ON public.fichadas USING btree (empresa_id, fecha);


--
-- Name: idx_fichadas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_fecha ON public.fichadas USING btree (fecha, legajo);


--
-- Name: idx_fichadas_geo_egreso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_geo_egreso ON public.fichadas USING gin (geo_egreso);


--
-- Name: idx_fichadas_geo_ingreso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_geo_ingreso ON public.fichadas USING gin (geo_ingreso);


--
-- Name: idx_fichadas_legajo_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_legajo_fecha ON public.fichadas USING btree (legajo, fecha);


--
-- Name: idx_fichadas_legajo_fecha_tarde; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fichadas_legajo_fecha_tarde ON public.fichadas USING btree (legajo, fecha, llegada_tarde);


--
-- Name: idx_geo_registros_empleado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geo_registros_empleado ON public.geo_registros USING btree (empleado_id, created_at DESC);


--
-- Name: idx_geo_zonas_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_geo_zonas_empresa ON public.geo_zonas USING btree (empresa_id);


--
-- Name: idx_invitaciones_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitaciones_codigo ON public.invitaciones_empresa USING btree (codigo) WHERE (activa = true);


--
-- Name: idx_invitaciones_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitaciones_empresa ON public.invitaciones_empresa USING btree (empresa_id);


--
-- Name: idx_login_attempts_ventana; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_ventana ON public.login_attempts USING btree (ventana);


--
-- Name: idx_mensajes_legajo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensajes_legajo ON public.mensajes_chat USING btree (legajo, created_at DESC);


--
-- Name: idx_metricas_eventos_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_eventos_created ON public.metricas_eventos USING btree (created_at);


--
-- Name: idx_metricas_eventos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_eventos_empresa ON public.metricas_eventos USING btree (empresa_id) WHERE (empresa_id IS NOT NULL);


--
-- Name: idx_metricas_eventos_evento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_eventos_evento ON public.metricas_eventos USING btree (evento);


--
-- Name: idx_metricas_eventos_evt_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_eventos_evt_date ON public.metricas_eventos USING btree (evento, created_at);


--
-- Name: idx_notas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_fecha ON public.notas_calendario USING btree (fecha);


--
-- Name: idx_notif_destinatario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_destinatario ON public.notificaciones USING btree (destinatario_rol, leida);


--
-- Name: idx_notif_no_leidas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_no_leidas ON public.notificaciones USING btree (empresa_id, created_at DESC) WHERE (leida = false);


--
-- Name: idx_notificaciones_dest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_dest ON public.notificaciones USING btree (destinatario_rol);


--
-- Name: idx_notificaciones_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notificaciones_empresa ON public.notificaciones USING btree (empresa_id);


--
-- Name: idx_pagos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_empresa ON public.pagos USING btree (empresa_id);


--
-- Name: idx_pagos_gw_pay; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_gw_pay ON public.pagos USING btree (gateway_payment_id);


--
-- Name: idx_pagos_susc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_susc ON public.pagos USING btree (suscripcion_id);


--
-- Name: idx_proyectos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proyectos_empresa ON public.proyectos USING btree (empresa_id);


--
-- Name: idx_proyectos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proyectos_estado ON public.proyectos USING btree (empresa_id, estado);


--
-- Name: idx_proyectos_ot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proyectos_ot ON public.proyectos USING btree (empresa_id, ot);


--
-- Name: idx_push_tokens_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_tokens_empresa ON public.push_tokens USING btree (legajo, empresa_id);


--
-- Name: idx_push_tokens_legajo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_tokens_legajo ON public.push_tokens USING btree (legajo);


--
-- Name: idx_rate_limits_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_created_at ON public.rate_limits USING btree (created_at);


--
-- Name: idx_registro_actividades_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registro_actividades_emp ON public.registro_actividades USING btree (empleado_id);


--
-- Name: idx_registro_actividades_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registro_actividades_fecha ON public.registro_actividades USING btree (fecha);


--
-- Name: idx_reportes_obra_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_obra_empresa ON public.reportes_obra USING btree (empresa_id);


--
-- Name: idx_reportes_obra_usuario_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reportes_obra_usuario_fecha ON public.reportes_obra USING btree (usuario_id, fecha DESC);


--
-- Name: idx_sesiones_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_empresa ON public.sesiones USING btree (empresa_id);


--
-- Name: idx_sesiones_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_jti ON public.sesiones USING btree (jti) WHERE (jti IS NOT NULL);


--
-- Name: idx_sesiones_legajo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_legajo ON public.sesiones USING btree (legajo);


--
-- Name: idx_sesiones_refresh_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_refresh_jti ON public.sesiones USING btree (refresh_jti) WHERE (refresh_jti IS NOT NULL);


--
-- Name: idx_sesiones_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_token ON public.sesiones USING btree (token_hash);


--
-- Name: idx_sesiones_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_token_hash ON public.sesiones USING btree (token_hash) WHERE (token_hash IS NOT NULL);


--
-- Name: idx_solicitudes_empleado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitudes_empleado ON public.solicitudes USING btree (legajo);


--
-- Name: idx_solicitudes_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitudes_empresa ON public.solicitudes USING btree (empresa_id);


--
-- Name: idx_solicitudes_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitudes_estado ON public.solicitudes USING btree (estado);


--
-- Name: idx_solicitudes_legajo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitudes_legajo ON public.solicitudes USING btree (legajo);


--
-- Name: idx_susc_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_empresa ON public.suscripciones USING btree (empresa_id);


--
-- Name: idx_susc_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_estado ON public.suscripciones USING btree (estado);


--
-- Name: idx_susc_gw_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_gw_sub ON public.suscripciones USING btree (gateway_subscription_id);


--
-- Name: idx_suscripciones_estado_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suscripciones_estado_global ON public.suscripciones USING btree (estado, created_at) WHERE (estado = 'activa'::text);


--
-- Name: idx_suscripciones_gateway_sub_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suscripciones_gateway_sub_id ON public.suscripciones USING btree (gateway_subscription_id) WHERE (gateway_subscription_id IS NOT NULL);


--
-- Name: idx_suscripciones_trial_vencer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suscripciones_trial_vencer ON public.suscripciones USING btree (trial_fin) WHERE (estado = 'trial'::text);


--
-- Name: idx_tipos_doc_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tipos_doc_empresa ON public.tipos_documento_requerido USING btree (empresa_id, activo);


--
-- Name: idx_turnos_plan_empleado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_turnos_plan_empleado ON public.turnos_planificados USING btree (empleado_id, fecha);


--
-- Name: idx_turnos_plan_empresa_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_turnos_plan_empresa_fecha ON public.turnos_planificados USING btree (empresa_id, fecha);


--
-- Name: uq_proyectos_emp_ot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_proyectos_emp_ot ON public.proyectos USING btree (empresa_id, ot);


--
-- Name: suscripciones susc_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER susc_updated BEFORE UPDATE ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.trg_susc_updated();


--
-- Name: registro_actividades trg_calcular_duracion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calcular_duracion BEFORE UPDATE ON public.registro_actividades FOR EACH ROW EXECUTE FUNCTION public.fn_calcular_duracion();


--
-- Name: registro_actividades trg_cerrar_tarea_previa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cerrar_tarea_previa AFTER INSERT ON public.registro_actividades FOR EACH ROW EXECUTE FUNCTION public.fn_cerrar_tarea_previa();


--
-- Name: proyectos trg_proyectos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proyectos_updated_at BEFORE UPDATE ON public.proyectos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_log audit_log_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: config_sistema config_sistema_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_sistema
    ADD CONSTRAINT config_sistema_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: divisiones divisiones_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divisiones
    ADD CONSTRAINT divisiones_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: documentos_empleado documentos_empleado_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_empleado
    ADD CONSTRAINT documentos_empleado_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE CASCADE;


--
-- Name: documentos_empleado documentos_empleado_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_empleado
    ADD CONSTRAINT documentos_empleado_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: documentos_empleado documentos_empleado_tipo_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_empleado
    ADD CONSTRAINT documentos_empleado_tipo_documento_id_fkey FOREIGN KEY (tipo_documento_id) REFERENCES public.tipos_documento_requerido(id) ON DELETE CASCADE;


--
-- Name: documentos_exigidos_empleado documentos_exigidos_empleado_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_exigidos_empleado
    ADD CONSTRAINT documentos_exigidos_empleado_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE CASCADE;


--
-- Name: documentos_exigidos_empleado documentos_exigidos_empleado_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_exigidos_empleado
    ADD CONSTRAINT documentos_exigidos_empleado_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: documentos_exigidos_empleado documentos_exigidos_empleado_tipo_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_exigidos_empleado
    ADD CONSTRAINT documentos_exigidos_empleado_tipo_documento_id_fkey FOREIGN KEY (tipo_documento_id) REFERENCES public.tipos_documento_requerido(id) ON DELETE CASCADE;


--
-- Name: email_eventos email_eventos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_eventos
    ADD CONSTRAINT email_eventos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE SET NULL;


--
-- Name: empleados empleados_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);


--
-- Name: empleados empleados_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleados
    ADD CONSTRAINT empleados_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: etapas etapas_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etapas
    ADD CONSTRAINT etapas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: fichadas fichadas_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichadas
    ADD CONSTRAINT fichadas_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id);


--
-- Name: fichadas fichadas_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichadas
    ADD CONSTRAINT fichadas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: empresa fk_empresa_susc_activa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa
    ADD CONSTRAINT fk_empresa_susc_activa FOREIGN KEY (suscripcion_activa_id) REFERENCES public.suscripciones(id) ON DELETE SET NULL;


--
-- Name: geo_registros geo_registros_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_registros
    ADD CONSTRAINT geo_registros_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE SET NULL;


--
-- Name: geo_registros geo_registros_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_registros
    ADD CONSTRAINT geo_registros_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: geo_registros geo_registros_fichada_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_registros
    ADD CONSTRAINT geo_registros_fichada_id_fkey FOREIGN KEY (fichada_id) REFERENCES public.fichadas(id) ON DELETE SET NULL;


--
-- Name: geo_zonas geo_zonas_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_zonas
    ADD CONSTRAINT geo_zonas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: invitaciones_empresa invitaciones_empresa_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitaciones_empresa
    ADD CONSTRAINT invitaciones_empresa_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: mensajes_chat mensajes_chat_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_chat
    ADD CONSTRAINT mensajes_chat_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: metricas_eventos metricas_eventos_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_eventos
    ADD CONSTRAINT metricas_eventos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE SET NULL;


--
-- Name: metricas_eventos metricas_eventos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_eventos
    ADD CONSTRAINT metricas_eventos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE SET NULL;


--
-- Name: notas_calendario notas_calendario_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_calendario
    ADD CONSTRAINT notas_calendario_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE SET NULL;


--
-- Name: notas_calendario notas_calendario_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_calendario
    ADD CONSTRAINT notas_calendario_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: notificaciones notificaciones_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: notificaciones notificaciones_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes(id);


--
-- Name: pagos pagos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: pagos pagos_suscripcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_suscripcion_id_fkey FOREIGN KEY (suscripcion_id) REFERENCES public.suscripciones(id) ON DELETE SET NULL;


--
-- Name: proyectos proyectos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proyectos
    ADD CONSTRAINT proyectos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: rate_limits rate_limits_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: registro_actividades registro_actividades_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registro_actividades
    ADD CONSTRAINT registro_actividades_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE CASCADE;


--
-- Name: registro_actividades registro_actividades_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registro_actividades
    ADD CONSTRAINT registro_actividades_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: reglas_bot reglas_bot_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reglas_bot
    ADD CONSTRAINT reglas_bot_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: reportes_obra reportes_obra_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reportes_obra
    ADD CONSTRAINT reportes_obra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: sesiones sesiones_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE CASCADE;


--
-- Name: solicitudes solicitudes_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id);


--
-- Name: solicitudes solicitudes_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id);


--
-- Name: suscripciones suscripciones_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: tipos_documento_requerido tipos_documento_requerido_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipos_documento_requerido
    ADD CONSTRAINT tipos_documento_requerido_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: turnos_planificados turnos_planificados_empleado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados
    ADD CONSTRAINT turnos_planificados_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES public.empleados(id) ON DELETE CASCADE;


--
-- Name: turnos_planificados turnos_planificados_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados
    ADD CONSTRAINT turnos_planificados_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresa(id) ON DELETE CASCADE;


--
-- Name: turnos_planificados turnos_planificados_proyecto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.turnos_planificados
    ADD CONSTRAINT turnos_planificados_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES public.proyectos(id) ON DELETE SET NULL;


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_deny_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_deny_all ON public.audit_log USING (false);


--
-- Name: config_sistema; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.config_sistema ENABLE ROW LEVEL SECURITY;

--
-- Name: cron_ejecuciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cron_ejecuciones ENABLE ROW LEVEL SECURITY;

--
-- Name: divisiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.divisiones ENABLE ROW LEVEL SECURITY;

--
-- Name: documentos_empleado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documentos_empleado ENABLE ROW LEVEL SECURITY;

--
-- Name: documentos_exigidos_empleado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documentos_exigidos_empleado ENABLE ROW LEVEL SECURITY;

--
-- Name: email_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: empleados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;

--
-- Name: empresa; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empresa ENABLE ROW LEVEL SECURITY;

--
-- Name: divisiones empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.divisiones FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: empleados empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.empleados FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: etapas empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.etapas FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: fichadas empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.fichadas FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notas_calendario empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.notas_calendario FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notificaciones empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.notificaciones FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: pagos empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.pagos FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: proyectos empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.proyectos FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: push_tokens empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.push_tokens FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: registro_actividades empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.registro_actividades FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reglas_bot empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.reglas_bot FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reportes_obra empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.reportes_obra FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: solicitudes empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.solicitudes FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: suscripciones empresa_isolation_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_insert ON public.suscripciones FOR INSERT WITH CHECK ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: divisiones empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.divisiones FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: empleados empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.empleados FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: etapas empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.etapas FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: fichadas empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.fichadas FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notas_calendario empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.notas_calendario FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notificaciones empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.notificaciones FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: pagos empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.pagos FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: proyectos empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.proyectos FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: push_tokens empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.push_tokens FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: registro_actividades empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.registro_actividades FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reglas_bot empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.reglas_bot FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reportes_obra empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.reportes_obra FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: solicitudes empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.solicitudes FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: suscripciones empresa_isolation_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_select ON public.suscripciones FOR SELECT USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: divisiones empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.divisiones FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: empleados empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.empleados FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: etapas empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.etapas FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: fichadas empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.fichadas FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notas_calendario empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.notas_calendario FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: notificaciones empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.notificaciones FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: pagos empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.pagos FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: proyectos empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.proyectos FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: push_tokens empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.push_tokens FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: registro_actividades empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.registro_actividades FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reglas_bot empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.reglas_bot FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: reportes_obra empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.reportes_obra FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: solicitudes empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.solicitudes FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: suscripciones empresa_isolation_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY empresa_isolation_update ON public.suscripciones FOR UPDATE USING ((empresa_id = COALESCE((((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'eid'::text))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)));


--
-- Name: etapas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.etapas ENABLE ROW LEVEL SECURITY;

--
-- Name: fichadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fichadas ENABLE ROW LEVEL SECURITY;

--
-- Name: geo_registros; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.geo_registros ENABLE ROW LEVEL SECURITY;

--
-- Name: geo_zonas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.geo_zonas ENABLE ROW LEVEL SECURITY;

--
-- Name: invitaciones_empresa; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitaciones_empresa ENABLE ROW LEVEL SECURITY;

--
-- Name: login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: mensajes_chat; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mensajes_chat ENABLE ROW LEVEL SECURITY;

--
-- Name: metricas_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metricas_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_calendario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_calendario ENABLE ROW LEVEL SECURITY;

--
-- Name: notificaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

--
-- Name: proyectos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proyectos ENABLE ROW LEVEL SECURITY;

--
-- Name: push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: registro_actividades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registro_actividades ENABLE ROW LEVEL SECURITY;

--
-- Name: reglas_bot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reglas_bot ENABLE ROW LEVEL SECURITY;

--
-- Name: reportes_obra; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reportes_obra ENABLE ROW LEVEL SECURITY;

--
-- Name: config_sistema service_role_all_config_sistema; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_config_sistema ON public.config_sistema TO service_role USING (true) WITH CHECK (true);


--
-- Name: divisiones service_role_all_divisiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_divisiones ON public.divisiones TO service_role USING (true) WITH CHECK (true);


--
-- Name: etapas service_role_all_etapas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_etapas ON public.etapas TO service_role USING (true) WITH CHECK (true);


--
-- Name: geo_registros service_role_all_geo_registros; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_geo_registros ON public.geo_registros TO service_role USING (true) WITH CHECK (true);


--
-- Name: geo_zonas service_role_all_geo_zonas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_geo_zonas ON public.geo_zonas TO service_role USING (true) WITH CHECK (true);


--
-- Name: invitaciones_empresa service_role_all_invitaciones_empresa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_invitaciones_empresa ON public.invitaciones_empresa TO service_role USING (true) WITH CHECK (true);


--
-- Name: mensajes_chat service_role_all_mensajes_chat; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_mensajes_chat ON public.mensajes_chat TO service_role USING (true) WITH CHECK (true);


--
-- Name: notas_calendario service_role_all_notas_calendario; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_notas_calendario ON public.notas_calendario TO service_role USING (true) WITH CHECK (true);


--
-- Name: pagos service_role_all_pagos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_pagos ON public.pagos TO service_role USING (true) WITH CHECK (true);


--
-- Name: proyectos service_role_all_proyectos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_proyectos ON public.proyectos TO service_role USING (true) WITH CHECK (true);


--
-- Name: push_tokens service_role_all_push_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_push_tokens ON public.push_tokens TO service_role USING (true) WITH CHECK (true);


--
-- Name: reglas_bot service_role_all_reglas_bot; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_reglas_bot ON public.reglas_bot TO service_role USING (true) WITH CHECK (true);


--
-- Name: suscripciones service_role_all_suscripciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_suscripciones ON public.suscripciones TO service_role USING (true) WITH CHECK (true);


--
-- Name: turnos_planificados service_role_all_turnos_planificados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_turnos_planificados ON public.turnos_planificados TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_eventos service_role_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access ON public.email_eventos USING ((current_setting('role'::text) = 'service_role'::text)) WITH CHECK ((current_setting('role'::text) = 'service_role'::text));


--
-- Name: metricas_eventos service_role_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_full_access ON public.metricas_eventos USING ((current_setting('role'::text) = 'service_role'::text)) WITH CHECK ((current_setting('role'::text) = 'service_role'::text));


--
-- Name: sesiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;

--
-- Name: solicitudes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.solicitudes ENABLE ROW LEVEL SECURITY;

--
-- Name: suscripciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;

--
-- Name: config_sistema tenant_isolation_auth_config_sistema; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_config_sistema ON public.config_sistema TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: divisiones tenant_isolation_auth_divisiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_divisiones ON public.divisiones TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: documentos_empleado tenant_isolation_auth_documentos_empleado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_documentos_empleado ON public.documentos_empleado TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: documentos_exigidos_empleado tenant_isolation_auth_documentos_exigidos_empleado; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_documentos_exigidos_empleado ON public.documentos_exigidos_empleado TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: empleados tenant_isolation_auth_empleados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_empleados ON public.empleados TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: POLICY tenant_isolation_auth_empleados ON empleados; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY tenant_isolation_auth_empleados ON public.empleados IS 'Defense-in-depth: scope authenticated role to empresa_id from JWT. App uses service_role, this is a safety net.';


--
-- Name: empresa tenant_isolation_auth_empresa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_empresa ON public.empresa FOR SELECT TO authenticated USING ((id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: etapas tenant_isolation_auth_etapas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_etapas ON public.etapas TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: fichadas tenant_isolation_auth_fichadas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_fichadas ON public.fichadas TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: geo_registros tenant_isolation_auth_geo_registros; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_geo_registros ON public.geo_registros TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: geo_zonas tenant_isolation_auth_geo_zonas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_geo_zonas ON public.geo_zonas TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: invitaciones_empresa tenant_isolation_auth_invitaciones_empresa; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_invitaciones_empresa ON public.invitaciones_empresa TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: mensajes_chat tenant_isolation_auth_mensajes_chat; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_mensajes_chat ON public.mensajes_chat TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: notas_calendario tenant_isolation_auth_notas_calendario; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_notas_calendario ON public.notas_calendario TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: notificaciones tenant_isolation_auth_notificaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_notificaciones ON public.notificaciones TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: pagos tenant_isolation_auth_pagos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_pagos ON public.pagos TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: proyectos tenant_isolation_auth_proyectos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_proyectos ON public.proyectos TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: push_tokens tenant_isolation_auth_push_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_push_tokens ON public.push_tokens TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: registro_actividades tenant_isolation_auth_registro_actividades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_registro_actividades ON public.registro_actividades TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: reglas_bot tenant_isolation_auth_reglas_bot; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_reglas_bot ON public.reglas_bot TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: reportes_obra tenant_isolation_auth_reportes_obra; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_reportes_obra ON public.reportes_obra TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: sesiones tenant_isolation_auth_sesiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_sesiones ON public.sesiones FOR SELECT TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: solicitudes tenant_isolation_auth_solicitudes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_solicitudes ON public.solicitudes TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: suscripciones tenant_isolation_auth_suscripciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_suscripciones ON public.suscripciones TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: tipos_documento_requerido tenant_isolation_auth_tipos_documento_requerido; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_tipos_documento_requerido ON public.tipos_documento_requerido TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: turnos_planificados tenant_isolation_auth_turnos_planificados; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_auth_turnos_planificados ON public.turnos_planificados TO authenticated USING ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid)) WITH CHECK ((empresa_id = (((current_setting('request.jwt.claims'::text, true))::json ->> 'eid'::text))::uuid));


--
-- Name: tipos_documento_requerido; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tipos_documento_requerido ENABLE ROW LEVEL SECURITY;

--
-- Name: turnos_planificados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.turnos_planificados ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION auto_fichar_egresos(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auto_fichar_egresos() FROM PUBLIC;
GRANT ALL ON FUNCTION public.auto_fichar_egresos() TO service_role;


--
-- Name: FUNCTION crear_sesion(p_empleado_id uuid, p_empresa_id uuid, p_ip text, p_user_agent text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crear_sesion(p_empleado_id uuid, p_empresa_id uuid, p_ip text, p_user_agent text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.crear_sesion(p_empleado_id uuid, p_empresa_id uuid, p_ip text, p_user_agent text) TO service_role;


--
-- Name: FUNCTION fichadas_hoy(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fichadas_hoy() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fichadas_hoy() TO service_role;


--
-- Name: FUNCTION fichadas_semana(p_legajo integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fichadas_semana(p_legajo integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fichadas_semana(p_legajo integer) TO service_role;


--
-- Name: FUNCTION fichar_egreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_forzar_cierre_tarea boolean, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fichar_egreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_forzar_cierre_tarea boolean, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fichar_egreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_forzar_cierre_tarea boolean, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer) TO service_role;


--
-- Name: FUNCTION fichar_ingreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fichar_ingreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fichar_ingreso(p_empleado_id uuid, p_legajo text, p_empresa_id uuid, p_geo_lat double precision, p_geo_lng double precision, p_geo_distancia integer) TO service_role;


--
-- Name: FUNCTION fn_calcular_duracion(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_calcular_duracion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_calcular_duracion() TO service_role;


--
-- Name: FUNCTION fn_cerrar_tarea_previa(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_cerrar_tarea_previa() FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_cerrar_tarea_previa() TO service_role;


--
-- Name: FUNCTION iniciar_trial_pro(p_empresa_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.iniciar_trial_pro(p_empresa_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.iniciar_trial_pro(p_empresa_id uuid) TO service_role;


--
-- Name: FUNCTION limpiar_push_tokens_huerfanos(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpiar_push_tokens_huerfanos() FROM PUBLIC;
GRANT ALL ON FUNCTION public.limpiar_push_tokens_huerfanos() TO service_role;


--
-- Name: FUNCTION limpiar_sesiones_expiradas(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.limpiar_sesiones_expiradas() FROM PUBLIC;
GRANT ALL ON FUNCTION public.limpiar_sesiones_expiradas() TO service_role;


--
-- Name: FUNCTION rpc_check_rate_limit(p_empresa_id uuid, p_ventana text, p_limite integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_check_rate_limit(p_empresa_id uuid, p_ventana text, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_check_rate_limit(p_empresa_id uuid, p_ventana text, p_limite integer) TO service_role;


--
-- Name: FUNCTION rpc_churn_mensual(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_churn_mensual() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_churn_mensual() TO service_role;


--
-- Name: FUNCTION rpc_conversion_cohortes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_conversion_cohortes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_conversion_cohortes() TO service_role;


--
-- Name: FUNCTION rpc_crear_empresa_con_admin(p_nombre_empresa text, p_nombre_corto text, p_admin_email text, p_admin_password text, p_rubro text, p_slug text, p_admin_nombre text, p_email_verify_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_crear_empresa_con_admin(p_nombre_empresa text, p_nombre_corto text, p_admin_email text, p_admin_password text, p_rubro text, p_slug text, p_admin_nombre text, p_email_verify_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_crear_empresa_con_admin(p_nombre_empresa text, p_nombre_corto text, p_admin_email text, p_admin_password text, p_rubro text, p_slug text, p_admin_nombre text, p_email_verify_token text) TO service_role;


--
-- Name: FUNCTION rpc_funnel_activacion(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_funnel_activacion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_funnel_activacion() TO service_role;


--
-- Name: FUNCTION rpc_login_attempt(p_ip text, p_ventana text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_login_attempt(p_ip text, p_ventana text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_login_attempt(p_ip text, p_ventana text) TO service_role;


--
-- Name: FUNCTION rpc_mrr_trending(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_mrr_trending() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_mrr_trending() TO service_role;


--
-- Name: FUNCTION rpc_revenue_por_plan(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_revenue_por_plan() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_revenue_por_plan() TO service_role;


--
-- Name: FUNCTION rpc_superadmin_empresas(p_limit integer, p_offset integer, p_search text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_superadmin_empresas(p_limit integer, p_offset integer, p_search text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_superadmin_empresas(p_limit integer, p_offset integer, p_search text) TO service_role;


--
-- Name: FUNCTION rpc_superadmin_stats(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rpc_superadmin_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpc_superadmin_stats() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION trg_susc_updated(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trg_susc_updated() FROM PUBLIC;
GRANT ALL ON FUNCTION public.trg_susc_updated() TO service_role;


--
-- Name: FUNCTION validar_sesion(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validar_sesion(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.validar_sesion(p_token text) TO service_role;


--
-- Name: FUNCTION vencer_trial_atomico(p_suscripcion_id bigint, p_empresa_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vencer_trial_atomico(p_suscripcion_id bigint, p_empresa_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vencer_trial_atomico(p_suscripcion_id bigint, p_empresa_id uuid) TO service_role;


--
-- Name: FUNCTION vencer_trials_batch(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vencer_trials_batch() FROM PUBLIC;
GRANT ALL ON FUNCTION public.vencer_trials_batch() TO service_role;


--
-- Name: FUNCTION vencer_trials_expirados(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vencer_trials_expirados() FROM PUBLIC;
GRANT ALL ON FUNCTION public.vencer_trials_expirados() TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO service_role;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;


--
-- Name: TABLE config_sistema; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.config_sistema TO service_role;


--
-- Name: TABLE cron_ejecuciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cron_ejecuciones TO service_role;


--
-- Name: TABLE divisiones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.divisiones TO service_role;


--
-- Name: TABLE documentos_empleado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documentos_empleado TO service_role;


--
-- Name: TABLE documentos_exigidos_empleado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documentos_exigidos_empleado TO service_role;


--
-- Name: TABLE email_eventos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_eventos TO service_role;


--
-- Name: SEQUENCE email_eventos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.email_eventos_id_seq TO service_role;


--
-- Name: TABLE empleados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.empleados TO service_role;


--
-- Name: TABLE empresa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.empresa TO service_role;


--
-- Name: TABLE etapas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.etapas TO service_role;


--
-- Name: TABLE fichadas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fichadas TO service_role;


--
-- Name: TABLE geo_registros; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.geo_registros TO service_role;


--
-- Name: SEQUENCE geo_registros_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.geo_registros_id_seq TO service_role;


--
-- Name: TABLE geo_zonas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.geo_zonas TO service_role;


--
-- Name: SEQUENCE geo_zonas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.geo_zonas_id_seq TO service_role;


--
-- Name: TABLE invitaciones_empresa; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invitaciones_empresa TO service_role;


--
-- Name: SEQUENCE invitaciones_empresa_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.invitaciones_empresa_id_seq TO service_role;


--
-- Name: TABLE login_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.login_attempts TO service_role;


--
-- Name: TABLE mensajes_chat; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mensajes_chat TO service_role;


--
-- Name: SEQUENCE mensajes_chat_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.mensajes_chat_id_seq TO service_role;


--
-- Name: TABLE metricas_eventos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.metricas_eventos TO service_role;


--
-- Name: SEQUENCE metricas_eventos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.metricas_eventos_id_seq TO service_role;


--
-- Name: TABLE notas_calendario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notas_calendario TO service_role;


--
-- Name: TABLE notificaciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notificaciones TO service_role;


--
-- Name: SEQUENCE notificaciones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.notificaciones_id_seq TO service_role;


--
-- Name: TABLE pagos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pagos TO service_role;


--
-- Name: TABLE proyectos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proyectos TO service_role;


--
-- Name: SEQUENCE proyectos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.proyectos_id_seq TO service_role;


--
-- Name: TABLE push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_tokens TO service_role;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE registro_actividades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.registro_actividades TO service_role;


--
-- Name: SEQUENCE registro_actividades_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.registro_actividades_id_seq TO service_role;


--
-- Name: TABLE reglas_bot; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reglas_bot TO service_role;


--
-- Name: SEQUENCE reglas_bot_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.reglas_bot_id_seq TO service_role;


--
-- Name: TABLE reportes_obra; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reportes_obra TO service_role;


--
-- Name: SEQUENCE reportes_obra_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.reportes_obra_id_seq TO service_role;


--
-- Name: TABLE sesiones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sesiones TO service_role;


--
-- Name: TABLE solicitudes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.solicitudes TO service_role;


--
-- Name: SEQUENCE solicitudes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.solicitudes_id_seq TO service_role;


--
-- Name: TABLE suscripciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.suscripciones TO service_role;


--
-- Name: TABLE tipos_documento_requerido; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tipos_documento_requerido TO service_role;


--
-- Name: TABLE turnos_planificados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.turnos_planificados TO service_role;


--
-- Name: SEQUENCE turnos_planificados_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.turnos_planificados_id_seq TO service_role;


--
-- Name: TABLE v_resumen_diario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_resumen_diario TO service_role;


--
-- Name: TABLE v_scores_empleados; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_scores_empleados TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



-- Igual que producción: anon/authenticated sin permisos sobre tablas ni secuencias.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

--
-- PostgreSQL database dump complete
--


