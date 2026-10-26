-- 137: prioridad manual de cada OT (planificación de la producción, parte 38;
-- diseño en notes/diseno-planificacion-produccion.md)
--
-- CONTEXTO: gerencia ordena las OT arrastrándolas en Proyectos →
-- Planificación → 📌 Prioridad. La de arriba es la más urgente. Las que no se
-- ordenan a mano quedan sin prioridad y van después, por semana de entrega.
--
-- Esta migración agrega proyectos.prioridad (1 = la más urgente; vacío = sin
-- prioridad manual). La sincronización con la planilla no la toca.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la pantalla avisa que falta). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists prioridad integer;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_prioridad_check') then
    alter table public.proyectos add constraint proyectos_prioridad_check
      check (prioridad is null or prioridad between 1 and 100000);
  end if;

  create index if not exists idx_proyectos_prioridad
    on public.proyectos (empresa_id, prioridad) where prioridad is not null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos' and column_name = 'prioridad';
