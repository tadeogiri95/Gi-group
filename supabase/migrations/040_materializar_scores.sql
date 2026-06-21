-- 040: Convertir v_scores_empleados de VIEW a MATERIALIZED VIEW.
-- La vista original (026) hace JOINs pesados en cada consulta.
-- Con MATERIALIZED VIEW + UNIQUE INDEX se puede usar REFRESH CONCURRENTLY
-- sin bloquear lecturas.

DROP VIEW IF EXISTS v_scores_empleados;

CREATE MATERIALIZED VIEW v_scores_empleados AS
WITH mes AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS inicio,
         (date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') + interval '1 month' - interval '1 day')::date AS fin
),
fichadas_mes AS (
  SELECT f.empleado_id,
         COUNT(*)::int AS dias_fichados,
         COALESCE(SUM(f.horas_trabajadas), 0) AS horas_trabajadas,
         COUNT(*) FILTER (WHERE f.llegada_tarde)::int AS tardanzas
    FROM fichadas f, mes
   WHERE f.fecha >= mes.inicio AND f.fecha <= mes.fin
   GROUP BY f.empleado_id
),
solicitudes_mes AS (
  SELECT s.empleado_id,
         COUNT(*)::int AS solicitudes_mes
    FROM solicitudes s, mes
   WHERE s.created_at >= mes.inicio::timestamp
     AND s.created_at < (mes.fin + 1)::timestamp
   GROUP BY s.empleado_id
)
SELECT e.id AS empleado_id,
       e.empresa_id,
       e.nombre,
       e.apodo,
       COALESCE(fm.dias_fichados, 0) AS dias_fichados,
       COALESCE(fm.horas_trabajadas, 0) AS horas_trabajadas,
       COALESCE(fm.tardanzas, 0) AS tardanzas,
       COALESCE(sm.solicitudes_mes, 0) AS solicitudes_mes,
       ROUND(
         LEAST(100, GREATEST(0,
           COALESCE(fm.dias_fichados, 0) * 3.0
           + COALESCE(fm.horas_trabajadas, 0) * 0.5
           - COALESCE(fm.tardanzas, 0) * 5.0
         ))
       , 1) AS score_em,
       ROUND(
         LEAST(100, GREATEST(0,
           COALESCE(fm.tardanzas, 0) * 10.0
           + COALESCE(sm.solicitudes_mes, 0) * 5.0
           - COALESCE(fm.dias_fichados, 0) * 2.0
         ))
       , 1) AS score_nc
  FROM empleados e
  LEFT JOIN fichadas_mes fm ON fm.empleado_id = e.id
  LEFT JOIN solicitudes_mes sm ON sm.empleado_id = e.id
 WHERE e.activo = true;

CREATE UNIQUE INDEX idx_scores_empleado ON v_scores_empleados (empleado_id);
CREATE INDEX idx_scores_empresa ON v_scores_empleados (empresa_id);

-- Función para refrescar la vista materializada (llamada desde pg_cron o cron externo).
CREATE OR REPLACE FUNCTION refresh_scores_empleados()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_scores_empleados;
END;
$$;
