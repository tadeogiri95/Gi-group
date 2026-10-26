-- 135: semana objetivo de cada OT (Gantt de OT y ⏰ OT atrasadas; diseño en
-- notes/diseno-gantt-ot.md)
--
-- CONTEXTO: en el Plan de trabajo la OT no tiene una fecha exacta de entrega
-- sino una semana objetivo (columna SEMANA, número de semana del año; pasado
-- diciembre sigue contando: 56 = fines de enero del año siguiente). La
-- columna ENTREGA casi siempre es texto libre ("Fines de octubre"), así que
-- no servía para saber qué OT están atrasadas.
--
-- Esta migración:
--   1. proyectos.semana_objetivo: el número de la columna SEMANA (la más
--      tardía si la OT tiene varios renglones). Vacío o 0 = sin semana.
--   2. proyectos.fecha_objetivo: el último día de esa semana, o la fecha de
--      entrega si la empresa eligió "Fecha de entrega". La calcula la
--      sincronización según cómo cuenta las semanas cada empresa
--      (config_sistema clave ot_fecha_objetivo). La usan el Gantt de OT y la
--      tarjeta ⏰ OT atrasadas del Panel.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la sincronización sigue andando sin estas columnas). Después de correrla,
-- apretar Sincronizar una vez en Proyectos → OT. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists semana_objetivo smallint;
  alter table public.proyectos add column if not exists fecha_objetivo date;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_semana_objetivo_check') then
    alter table public.proyectos add constraint proyectos_semana_objetivo_check
      check (semana_objetivo is null or semana_objetivo between 1 and 160);
  end if;

  create index if not exists idx_proyectos_fecha_objetivo
    on public.proyectos (empresa_id, fecha_objetivo) where fecha_objetivo is not null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver dos filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('semana_objetivo', 'fecha_objetivo');
