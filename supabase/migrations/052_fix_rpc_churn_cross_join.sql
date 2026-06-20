-- ════════════════════════════════════════════════════════════════════
-- 052_fix_rpc_churn_cross_join.sql
--
-- rpc_churn_mensual (048) hace "LEFT JOIN metricas_eventos me ON true"
-- y "LEFT JOIN suscripciones s ON true" — sin condición de correlación,
-- eso es un CROSS JOIN: genera meses(12) × metricas_eventos × suscripciones
-- filas ANTES de agregar. Con los volúmenes actuales (decenas de filas)
-- es invisible, pero crece multiplicativamente: con 50.000 eventos y
-- 5.000 suscripciones ya son 12 × 50.000 × 5.000 = 3.000 millones de filas
-- intermedias por cada llamada al dashboard de superadmin.
--
-- Fix: precalcular churn y activas_inicio por mes con CTEs agregadas
-- (un solo GROUP BY scan de cada tabla en vez de producto cartesiano),
-- igual al patrón ya usado en rpc_mrr_trending y rpc_conversion_cohortes.
-- ════════════════════════════════════════════════════════════════════

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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Índice global de soporte: rpc_churn_mensual y rpc_revenue_por_plan filtran
-- suscripciones por estado SIN empresa_id (son RPCs de superadmin, cross-tenant).
-- idx_suscripciones_empresa_estado (041/005) tiene empresa_id como columna líder,
-- no sirve para este patrón global.
CREATE INDEX IF NOT EXISTS idx_suscripciones_estado_global
  ON suscripciones (estado, created_at)
  WHERE estado = 'activa';
