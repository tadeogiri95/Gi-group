-- 144: SEMANA de cada OT editable desde Gypi (Planificación ② y Detalle OT;
-- app/lib/semanaEditable.js)
--
-- CONTEXTO: la SEMANA viene del Plan de trabajo. Desde Gypi se puede cambiar
-- y un script en la planilla la anota en la columna SEMANA. Si se cambia en
-- los dos lados, gana el cambio más reciente (Tadeo, 29/10).
--   semana_app       semana que se eligió en Gypi y todavía no llegó a la planilla
--   semana_app_at    cuándo se eligió
--   semana_planilla  la semana que trajo la planilla en la última sincronización
-- Cuando la planilla trae la misma semana que se eligió en Gypi, semana_app
-- se borra (ya llegó).
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- cambiar la semana avisa que falta la migración). Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists semana_app integer;
  alter table public.proyectos add column if not exists semana_app_at timestamptz;
  alter table public.proyectos add column if not exists semana_planilla integer;
  -- Lo que hay hoy vino de la planilla
  update public.proyectos set semana_planilla = semana_objetivo
    where semana_planilla is null and semana_objetivo is not null and semana_app is null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver tres filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('semana_app', 'semana_app_at', 'semana_planilla');
