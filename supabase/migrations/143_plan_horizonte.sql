-- 143: plan de producción sin límite de semanas (Tadeo, 27/10)
--
-- CONTEXTO: en Proyectos → Planificación → 📊 Carga, "Ordenar
-- automáticamente" ya no corta en la semana o el mes elegidos: reparte las OT
-- desde hoy hasta que terminan (según las fechas objetivo de la columna
-- SEMANA, con horas extra, o según la capacidad de la planta). Ese plan se
-- guarda como tipo 'horizonte' y puede durar varios meses.
--
-- Esta migración:
--   1. Suma el tipo 'horizonte' a planes_produccion.tipo.
--   2. Deja que un plan dure hasta 400 días (antes, 62).
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la pantalla avisa que falta al guardar). Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
declare
  c record;
begin
  -- Se borran los controles viejos de tipo y de largo (nombres automáticos)
  for c in
    select conname from pg_constraint
    where conrelid = 'public.planes_produccion'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%tipo%' or pg_get_constraintdef(oid) ilike '%hasta%')
  loop
    execute format('alter table public.planes_produccion drop constraint %I', c.conname);
  end loop;

  alter table public.planes_produccion
    add constraint planes_produccion_tipo_check check (tipo in ('semana', 'mes', 'horizonte'));
  alter table public.planes_produccion
    add constraint planes_produccion_largo_check check (hasta >= desde and hasta - desde <= 400);
end
$mig$;
