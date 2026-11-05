-- 157: fecha elegida a mano para instalar una OT (Gantt de instalación;
-- diseño en notes/diseno-gantt-instalacion.md; app/lib/planInstalacion.js)
--
-- CONTEXTO: Tadeo (05/11) quiere acomodar las obras en el 🔧 Gantt de
-- instalación tomándolas y arrastrándolas a otro día. Lo que se elige queda
-- como "instalar desde tal día" en cada OT de la obra. Nunca puede ser antes
-- del día hábil siguiente a que termina la producción: si producción se
-- atrasa, manda producción.
--   instalacion_desde: primer día en que se puede instalar la OT
--   (vacío = automático, apenas sale de fábrica).
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el Gantt avisa que para mover obras falta la migración). Es idempotente. Va
-- en un solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists instalacion_desde date;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name = 'instalacion_desde';
