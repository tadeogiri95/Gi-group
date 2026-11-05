-- 161: plan de Diseño y Técnica confirmado (Gantt de Diseño y Técnica, parte
-- 50; diseño en notes/diseno-gantt-diseno-tecnica.md; cálculo en
-- app/lib/planDisenoTecnica.js)
--
-- CONTEXTO: el Dueño o un supervisor puede cambiar en el Gantt 📐 el orden de
-- las planillas técnicas (arrastrando) y elegir qué arquitecta hace cada una.
-- Con "✅ Confirmar plan" queda guardado en cada OT:
--   1. orden_tecnica: lugar de la OT en el orden de Técnica (1 = la primera).
--      Vacío = va después de las ordenadas, por la prioridad de Producción.
--   2. arquitecta_tecnica: id del empleado que hace la planilla. Vacío = la
--      que la termina antes. Si en el Plan de trabajo ya figuran las iniciales
--      de otra arquitecta, manda el Plan.
--   3. tecnica_fin_confirmado: día en que terminaba la Técnica en el plan
--      confirmado, para avisar cuánto se corrió.
-- Cada arquitecta ve sus planillas en "📐 Mis planillas" (sin migración).
--
-- ORDEN: correrla antes de unir el PR (sin ella el Gantt anda igual, pero
-- "Confirmar plan" avisa que falta la migración). Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists orden_tecnica integer;
  alter table public.proyectos add column if not exists arquitecta_tecnica text;
  alter table public.proyectos add column if not exists tecnica_fin_confirmado date;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_orden_tecnica_chk') then
    alter table public.proyectos add constraint proyectos_orden_tecnica_chk
      check (orden_tecnica is null or (orden_tecnica >= 1 and orden_tecnica <= 99999));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_arquitecta_tecnica_chk') then
    alter table public.proyectos add constraint proyectos_arquitecta_tecnica_chk
      check (arquitecta_tecnica is null or (length(arquitecta_tecnica) between 1 and 64));
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver tres filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('orden_tecnica', 'arquitecta_tecnica', 'tecnica_fin_confirmado');
