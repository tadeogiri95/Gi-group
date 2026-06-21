-- 046: RPC para listar empresas en superadmin con paginación.
-- Reemplaza 3 queries paralelas (empresa + suscripciones + empleados)
-- que cargaban tablas completas sin límite.

-- Devuelve página de empresas con suscripción y conteo de empleados en una sola query.
CREATE OR REPLACE FUNCTION rpc_superadmin_empresas(
  p_limit  int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Summary stats for the dashboard header (lightweight, no row data).
CREATE OR REPLACE FUNCTION rpc_superadmin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
