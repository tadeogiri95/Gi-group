-- 099: paradas con códigos propios, cantidad por tarea y unidad por etapa
-- (Órdenes de Producción, parte 4; ítem 39)
--
-- CONTEXTO: el mapa de procesos de la fábrica pide anotar las paradas con
-- códigos propios (SP, SM, MA, RO, CA, OT), con la obra en la que se estaba,
-- y la cantidad hecha en cada puesto (placas, metros de canto, piezas,
-- módulos). Además, registro_actividades solo aceptaba etapas del 0 al 8, así
-- que una etapa nueva con código 9 o más no se podía usar.
--
-- Esta migración:
--   1. registro_actividades.causa pasa de 1 letra fija (M, H, I, O) a un
--      código de hasta 4 letras o números. La lista de cada empresa se guarda
--      en config_sistema (clave 'causas_parada'). Para cambiar el tipo hay que
--      rehacer v_resumen_diario, que usa la columna: misma definición que 096.
--   2. etapa: de 0 a 999 (antes 0 a 8), igual que los códigos de etapa.
--   3. Una parada (etapa 0) puede llevar la OT en la que se estaba.
--   4. registro_actividades.cantidad: lo hecho en la tarea (opcional, >= 0).
--   5. etapas.unidad: en qué se mide cada etapa (opcional, hasta 20 letras).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción: si algo falla, no cambia nada.

begin;

-- ─── 1. causa: código de hasta 4 caracteres ────────────────────────────────
drop view if exists public.v_resumen_diario;

alter table public.registro_actividades drop constraint if exists chk_causa;
alter table public.registro_actividades alter column causa type text using trim(causa);
alter table public.registro_actividades add constraint chk_causa
  check (causa is null or causa ~ '^[A-Z0-9]{1,4}$');

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

grant select on public.v_resumen_diario to authenticated;

-- ─── 2. etapa de 0 a 999 ────────────────────────────────────────────────────
alter table public.registro_actividades drop constraint if exists chk_etapa;
alter table public.registro_actividades add constraint chk_etapa
  check (etapa >= 0 and etapa <= 999);

-- ─── 3. una parada puede llevar la OT ──────────────────────────────────────
alter table public.registro_actividades drop constraint if exists chk_proyecto_etapa;
alter table public.registro_actividades add constraint chk_proyecto_etapa
  check (etapa = 0 or codigo_proyecto is not null);

-- ─── 4. cantidad hecha en la tarea ─────────────────────────────────────────
alter table public.registro_actividades add column if not exists cantidad numeric(10,2);
alter table public.registro_actividades drop constraint if exists chk_cantidad;
alter table public.registro_actividades add constraint chk_cantidad
  check (cantidad is null or cantidad >= 0);

-- ─── 5. unidad de cada etapa ───────────────────────────────────────────────
alter table public.etapas add column if not exists unidad text;
alter table public.etapas drop constraint if exists chk_etapas_unidad;
alter table public.etapas add constraint chk_etapas_unidad
  check (unidad is null or char_length(unidad) <= 20);

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.registro_actividades'::regclass
--     and conname in ('chk_causa', 'chk_etapa', 'chk_proyecto_etapa', 'chk_cantidad');
--   -- esperado: causa ~ '^[A-Z0-9]{1,4}$', etapa 0 a 999, etapa = 0 OR codigo_proyecto IS NOT NULL, cantidad >= 0
--   select column_name, data_type from information_schema.columns
--   where (table_name = 'registro_actividades' and column_name in ('causa', 'cantidad'))
--      or (table_name = 'etapas' and column_name = 'unidad');
--   -- esperado: causa text, cantidad numeric, unidad text
