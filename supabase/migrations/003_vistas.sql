-- ═══════════════════════════════════════════════════════════════════════════
-- 003_vistas.sql — Vistas de agregación
--
-- ⚠️ NO EJECUTAR. Documentación del estado actual.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- v_resumen_diario
--
-- Vista que consume el dashboard de gerencia. Una fila por empleado/fecha,
-- con su estado productivo del día (etapa actual, minutos productivos vs
-- minutos en espera, %productivo).
--
-- Columnas usadas en el frontend (dashboard_gerencia.jsx, gerencia_actividad_screen.jsx):
--   - legajo, fecha, nombre, division
--   - etapa_actual         (null = sin tarea, 0 = en espera, >0 = etapa productiva)
--   - minutos_productivos
--   - minutos_espera
--   - pct_productivo
--   - empresa_id           (para filtrado multi-tenant)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_resumen_diario AS
WITH actividad_dia AS (
  SELECT
    ra.empresa_id,
    ra.empleado_id,
    ra.legajo,
    ra.fecha,
    ra.division,
    -- etapa activa: la última sin hora_fin, o la última cerrada si no hay activa
    (SELECT ra2.etapa
       FROM registro_actividades ra2
      WHERE ra2.empleado_id = ra.empleado_id
        AND ra2.fecha       = ra.fecha
      ORDER BY ra2.hora_inicio DESC
      LIMIT 1)               AS etapa_actual,
    SUM(
      CASE WHEN ra.etapa > 0
           THEN EXTRACT(EPOCH FROM (COALESCE(ra.hora_fin, now()) - ra.hora_inicio)) / 60
           ELSE 0 END
    )                        AS minutos_productivos,
    SUM(
      CASE WHEN ra.etapa = 0
           THEN EXTRACT(EPOCH FROM (COALESCE(ra.hora_fin, now()) - ra.hora_inicio)) / 60
           ELSE 0 END
    )                        AS minutos_espera
    FROM registro_actividades ra
   GROUP BY ra.empresa_id, ra.empleado_id, ra.legajo, ra.fecha, ra.division
)
SELECT
  a.empresa_id,
  a.empleado_id,
  a.legajo,
  e.nombre,
  a.division,
  a.fecha,
  a.etapa_actual,
  ROUND(a.minutos_productivos::numeric, 1) AS minutos_productivos,
  ROUND(a.minutos_espera::numeric, 1)      AS minutos_espera,
  CASE
    WHEN (a.minutos_productivos + a.minutos_espera) > 0
    THEN ROUND(a.minutos_productivos * 100.0 / (a.minutos_productivos + a.minutos_espera), 1)
    ELSE 0
  END                                       AS pct_productivo
FROM actividad_dia a
JOIN empleados e ON e.id = a.empleado_id;

-- VERIFICAR: la definición real en producción podría incluir más columnas
-- (estado del fichaje, horas trabajadas, etc.) o usar window functions
-- en lugar del subquery. Confirmar contra Supabase Studio antes de
-- replicar este DDL en otra instancia.
