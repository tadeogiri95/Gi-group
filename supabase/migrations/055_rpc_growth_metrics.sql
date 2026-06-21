-- 055: RPCs de growth para el dashboard de superadmin.
-- Health score por empresa (señal de engagement/riesgo de churn) y
-- tasas de apertura/click de los emails transaccionales (vía email_eventos, 054).

-- ─── Health score por empresa activa ───
-- Combina: % de empleados que ficharon en los últimos 7 días (hasta 50pts),
-- recencia del último fichaje (hasta 30pts), onboarding completo (10pts)
-- y volumen de eventos de producto en los últimos 30 días (hasta 10pts).
CREATE OR REPLACE FUNCTION rpc_health_score_empresas()
RETURNS TABLE(
  empresa_id uuid,
  nombre text,
  plan_activo text,
  onboarding_completado boolean,
  empleados_activos bigint,
  empleados_fichando_7d bigint,
  dias_desde_ultimo_fichaje integer,
  eventos_30d bigint,
  health_score integer,
  riesgo text
) AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      e.id AS empresa_id,
      e.nombre,
      e.plan_activo,
      e.onboarding_completado,
      (SELECT COUNT(*) FROM empleados emp WHERE emp.empresa_id = e.id AND emp.activo = true) AS empleados_activos,
      (SELECT COUNT(DISTINCT f.empleado_id) FROM fichadas f WHERE f.empresa_id = e.id AND f.fecha >= current_date - 7) AS empleados_fichando_7d,
      (SELECT MAX(f.fecha) FROM fichadas f WHERE f.empresa_id = e.id) AS ultima_fichada,
      (SELECT COUNT(*) FROM metricas_eventos me WHERE me.empresa_id = e.id AND me.created_at >= now() - interval '30 days') AS eventos_30d
    FROM empresa e
    WHERE e.activa = true
  ),
  scored AS (
    SELECT
      b.*,
      CASE WHEN b.ultima_fichada IS NULL THEN NULL ELSE (current_date - b.ultima_fichada) END AS dias_fichaje,
      (
        ROUND(LEAST(1.0, b.empleados_fichando_7d::numeric / GREATEST(b.empleados_activos, 1)) * 50)
        + CASE
            WHEN b.ultima_fichada IS NULL THEN 0
            WHEN current_date - b.ultima_fichada <= 1 THEN 30
            WHEN current_date - b.ultima_fichada <= 3 THEN 22
            WHEN current_date - b.ultima_fichada <= 7 THEN 14
            WHEN current_date - b.ultima_fichada <= 14 THEN 6
            ELSE 0
          END
        + CASE WHEN b.onboarding_completado THEN 10 ELSE 0 END
        + LEAST(b.eventos_30d, 10)
      )::integer AS health_score
    FROM base b
  )
  SELECT
    s.empresa_id, s.nombre, s.plan_activo, s.onboarding_completado,
    s.empleados_activos, s.empleados_fichando_7d,
    s.dias_fichaje::integer AS dias_desde_ultimo_fichaje,
    s.eventos_30d,
    s.health_score,
    CASE WHEN s.health_score < 30 THEN 'alto' WHEN s.health_score < 60 THEN 'medio' ELSE 'bajo' END AS riesgo
  FROM scored s
  ORDER BY s.health_score ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── Engagement de emails por tipo (últimos 90 días) ───
CREATE OR REPLACE FUNCTION rpc_email_engagement()
RETURNS TABLE(
  tipo_email text,
  enviados bigint,
  entregados bigint,
  abiertos bigint,
  clickeados bigint,
  rebotados bigint,
  tasa_apertura numeric,
  tasa_click numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(ee.tipo_email, 'desconocido') AS tipo_email,
    COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'sent')      AS enviados,
    COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'delivered') AS entregados,
    COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'opened')    AS abiertos,
    COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'clicked')  AS clickeados,
    COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'bounced')  AS rebotados,
    CASE WHEN COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'delivered') > 0
      THEN ROUND(COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'opened')::numeric
        / COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'delivered')::numeric * 100, 1)
      ELSE 0 END AS tasa_apertura,
    CASE WHEN COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'delivered') > 0
      THEN ROUND(COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'clicked')::numeric
        / COUNT(DISTINCT ee.resend_email_id) FILTER (WHERE ee.evento = 'delivered')::numeric * 100, 1)
      ELSE 0 END AS tasa_click
  FROM email_eventos ee
  WHERE ee.created_at >= now() - interval '90 days'
  GROUP BY ee.tipo_email
  ORDER BY enviados DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
