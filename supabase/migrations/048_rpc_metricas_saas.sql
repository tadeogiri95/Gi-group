-- 048: RPCs para métricas SaaS del superadmin dashboard.
-- MRR trending, churn rate, conversión por cohorte, funnel de activación.

-- ─── MRR por mes (últimos 12 meses) ───
CREATE OR REPLACE FUNCTION rpc_mrr_trending()
RETURNS TABLE(mes text, mrr numeric, suscripciones_activas bigint) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── Conversión por cohorte mensual de registro ───
CREATE OR REPLACE FUNCTION rpc_conversion_cohortes()
RETURNS TABLE(
  cohorte text,
  registradas bigint,
  completaron_onboarding bigint,
  primera_fichada bigint,
  convirtieron_pago bigint
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── Churn mensual (empresas que pasaron de activa/trial a cancelada/vencida) ───
CREATE OR REPLACE FUNCTION rpc_churn_mensual()
RETURNS TABLE(mes text, churned bigint, activas_inicio bigint, churn_rate numeric) AS $$
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
    COUNT(DISTINCT me.empresa_id) FILTER (
      WHERE me.evento = 'churn' AND me.created_at >= m.fecha_inicio AND me.created_at < m.fecha_fin
    ) AS churned,
    COUNT(DISTINCT s.empresa_id) FILTER (
      WHERE s.estado = 'activa' AND s.created_at < m.fecha_inicio
    ) AS activas_inicio,
    CASE
      WHEN COUNT(DISTINCT s.empresa_id) FILTER (WHERE s.estado = 'activa' AND s.created_at < m.fecha_inicio) > 0
      THEN ROUND(
        COUNT(DISTINCT me.empresa_id) FILTER (WHERE me.evento = 'churn' AND me.created_at >= m.fecha_inicio AND me.created_at < m.fecha_fin)::numeric /
        COUNT(DISTINCT s.empresa_id) FILTER (WHERE s.estado = 'activa' AND s.created_at < m.fecha_inicio)::numeric * 100,
        1
      )
      ELSE 0
    END AS churn_rate
  FROM meses m
  LEFT JOIN metricas_eventos me ON true
  LEFT JOIN suscripciones s ON true
  GROUP BY m.mes, m.fecha_inicio, m.fecha_fin
  ORDER BY m.mes;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── Revenue por plan (snapshot actual) ───
CREATE OR REPLACE FUNCTION rpc_revenue_por_plan()
RETURNS TABLE(plan text, empresas bigint, mrr numeric) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── Funnel de activación (totales globales) ───
CREATE OR REPLACE FUNCTION rpc_funnel_activacion()
RETURNS TABLE(paso text, cantidad bigint) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
