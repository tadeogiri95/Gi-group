-- 096: RLS real en las vistas de resumen del tablero (ítem 37, etapa 3)
--
-- CONTEXTO: v_resumen_diario y v_scores_empleados se leían siempre con
-- service_role (que se saltea la RLS) y solo las separaba por empresa el
-- filtro empresa_id que agrega /api/data. Una vista común corre con los
-- permisos de su dueño, así que tampoco aplicaba la RLS de sus tablas.
--
-- Esta migración:
--   1. Rehace v_resumen_diario con security_invoker: la vista aplica la RLS de
--      empleados, fichadas y registro_actividades con el pase de quien
--      consulta. De paso corrige la unión con fichadas, que era solo por
--      legajo: un empleado podía mostrar el ingreso de alguien de OTRA empresa
--      con el mismo legajo. Ahora también exige la misma empresa_id. Mismas
--      columnas que en producción (línea base del 2026-10-07).
--   2. Pone security_invoker en v_scores_empleados si es una vista común (así
--      está en producción). Si en esta base es una vista materializada (040),
--      no se puede: avisa, no le da permisos a `authenticated` y queda solo
--      para service_role.
--   3. Da SELECT en las vistas a `authenticated`, nada más. Sin anon.
--
-- Con service_role nada cambia (se saltea la RLS igual que antes), así que se
-- puede correr en cualquier momento. La app empieza a leer las vistas con el
-- pase del usuario cuando están prendidos RLS_API_DATA=on y RLS_RUTAS=on.
--
-- ORDEN: correr ANTES de unir el PR que la usa (RLS_RUTAS puede estar ya
-- prendido). Es idempotente y no va en una transacción.

-- ─── 1. v_resumen_diario ───────────────────────────────────────────────────
create or replace view public.v_resumen_diario
  with (security_invoker = true) as
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
     LEFT JOIN public.fichadas f ON (((f.legajo = e.legajo) AND (f.empresa_id = e.empresa_id) AND (f.fecha = CURRENT_DATE))))
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

-- ─── 2 y 3. v_scores_empleados y permisos ──────────────────────────────────
do $$
declare
  tipo "char";
begin
  select c.relkind into tipo
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'v_scores_empleados';

  if tipo = 'v' then
    execute 'alter view public.v_scores_empleados set (security_invoker = true)';
    execute 'grant select on public.v_scores_empleados to authenticated';
  elsif tipo = 'm' then
    raise notice 'v_scores_empleados es una vista materializada: queda solo para service_role';
  else
    raise notice 'v_scores_empleados no existe, se saltea';
  end if;
end $$;

grant select on public.v_resumen_diario to authenticated;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select c.relname, c.relkind, c.reloptions
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relname in ('v_resumen_diario', 'v_scores_empleados');
--   -- esperado: las dos con relkind 'v' y reloptions {security_invoker=true}
