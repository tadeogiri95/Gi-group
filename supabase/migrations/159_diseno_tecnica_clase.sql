-- 159: etapas de Diseño y Técnica de cada OT y su clase de complejidad A/B/C
-- (Gantt de Diseño y Técnica, parte 46; diseño en
-- notes/diseno-gantt-diseno-tecnica.md; cálculo en app/lib/complejidad.js)
--
-- CONTEXTO: Tadeo (05/11) quiere un Gantt para Diseño y Técnica, antes de
-- Producción. Esta parte guarda lo que hace falta para eso:
--   etapas_diseno: estado de cada etapa según el Nuevo Plan de trabajo
--     (Diseño: DIS, SKP, INFO PROY, RELEV, N.P; Técnica: N.F, EXCEL, PDF).
--     Ej.: {"dis": {"e": "hecho", "q": "GR"}, "relev": {"e": "na"}, "excel": {"e": "falta"}}.
--     La escribe la sincronización del Plan.
--   clase_auto: clase A, B o C calculada dentro del tipo de proyecto con las
--     cantidades de la OT (componentes, placas, canto). La escribe la
--     sincronización (Plan y MRP). Vacía = sin datos todavía.
--   clase_complejidad: clase elegida a mano por gestión; manda sobre la
--     automática. Vacía = automática.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la sincronización sigue igual sin estas columnas). Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists etapas_diseno jsonb;
  alter table public.proyectos add column if not exists clase_auto text;
  alter table public.proyectos add column if not exists clase_complejidad text;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_clase_auto_chk') then
    alter table public.proyectos add constraint proyectos_clase_auto_chk
      check (clase_auto is null or clase_auto in ('A', 'B', 'C'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_clase_complejidad_chk') then
    alter table public.proyectos add constraint proyectos_clase_complejidad_chk
      check (clase_complejidad is null or clase_complejidad in ('A', 'B', 'C'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'proyectos_etapas_diseno_chk') then
    alter table public.proyectos add constraint proyectos_etapas_diseno_chk
      check (etapas_diseno is null or (jsonb_typeof(etapas_diseno) = 'object' and pg_column_size(etapas_diseno) <= 4000));
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver tres filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('etapas_diseno', 'clase_auto', 'clase_complejidad');
