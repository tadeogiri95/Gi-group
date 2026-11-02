-- 153: días de instalación de cada OT (planificación de la instalación,
-- parte 42; diseño en notes/diseno-gantt-instalacion.md; app/lib/instalacionPlan.js)
--
-- CONTEXTO: la SEMANA de la planilla es la entrega del proyecto ya instalado
-- (Tadeo, 02/11). Para planificar la instalación, Gypi calcula los días de
-- obra de cada OT con sus gabinetes y cuántos gabinetes instala una persona
-- por día (⚙ Parámetros → 🔧 Instalación). Gestión lo puede corregir a mano
-- en el Detalle de la OT, y queda guardado acá (la sincronización con la
-- planilla no lo pisa):
--   1. dias_instalacion: días de obra, de a medio día (vacío = automático).
--   2. personas_instalacion: instaladores que van (vacío = los de ⚙ Parámetros, 2).
--   3. prioridad_instalacion: lugar de la OT en el plan de instalación
--      (1 = la más urgente; vacío = por fecha de entrega). Lo usa la parte 44.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el cálculo automático anda igual y el Detalle avisa que para corregir a mano
-- falta la migración). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists dias_instalacion numeric(5, 1);
  alter table public.proyectos add column if not exists personas_instalacion smallint;
  alter table public.proyectos add column if not exists prioridad_instalacion integer;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_dias_instalacion_check') then
    alter table public.proyectos add constraint proyectos_dias_instalacion_check
      check (dias_instalacion is null or (dias_instalacion >= 0.5 and dias_instalacion <= 200 and dias_instalacion * 2 = trunc(dias_instalacion * 2)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_personas_instalacion_check') then
    alter table public.proyectos add constraint proyectos_personas_instalacion_check
      check (personas_instalacion is null or personas_instalacion between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_prioridad_instalacion_check') then
    alter table public.proyectos add constraint proyectos_prioridad_instalacion_check
      check (prioridad_instalacion is null or prioridad_instalacion > 0);
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver tres filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('dias_instalacion', 'personas_instalacion', 'prioridad_instalacion');
