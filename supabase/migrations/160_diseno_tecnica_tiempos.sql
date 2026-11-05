-- 160: tiempos de Diseño y Técnica corregidos a mano en cada OT
-- (Gantt de Diseño y Técnica, parte 47; diseño en
-- notes/diseno-gantt-diseno-tecnica.md; cálculo en app/lib/disenoTecnicaPlan.js)
--
-- CONTEXTO: Diseño (relevamiento, diseño, aprobación) lleva una cantidad fija
-- de días hábiles (⚙ Parámetros → 📐 Diseño y Técnica, 10 por defecto) y
-- Técnica las horas de la tabla tipo de proyecto × clase A/B/C. Gestión lo
-- puede corregir a mano en el Detalle de la OT, y queda guardado acá (la
-- sincronización con la planilla no lo pisa):
--   1. dias_diseno: días hábiles de Diseño, de a medio día (vacío = ⚙ Parámetros).
--   2. horas_tecnica: horas de la planilla técnica, de a media hora (vacío = la tabla).
--
-- Los parámetros (días por defecto, tabla de horas, arquitectas con su %) van
-- en config_sistema, clave "planificacion": no necesitan migración.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el cálculo con ⚙ Parámetros anda igual y el Detalle avisa que para corregir
-- a mano falta la migración). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists dias_diseno numeric(5, 1);
  alter table public.proyectos add column if not exists horas_tecnica numeric(6, 1);

  if not exists (select 1 from pg_constraint where conname = 'proyectos_dias_diseno_chk') then
    alter table public.proyectos add constraint proyectos_dias_diseno_chk
      check (dias_diseno is null or (dias_diseno >= 0.5 and dias_diseno <= 200 and dias_diseno * 2 = trunc(dias_diseno * 2)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_horas_tecnica_chk') then
    alter table public.proyectos add constraint proyectos_horas_tecnica_chk
      check (horas_tecnica is null or (horas_tecnica >= 0.5 and horas_tecnica <= 1000 and horas_tecnica * 2 = trunc(horas_tecnica * 2)));
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver dos filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('dias_diseno', 'horas_tecnica');
