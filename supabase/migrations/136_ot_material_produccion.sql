-- 136: material de producción de cada OT (planificación de la planta; diseño
-- en notes/diseno-planificacion-produccion.md, parte 37)
--
-- CONTEXTO: el Plan de trabajo trae, por renglón, cuántas placas de 18 mm
-- (PLA 18), fondos (FONDOS), metros de canto (CANTOS) y placas mecanizadas
-- (MECANIZADOS) lleva cada ítem. Son el total del renglón (no se multiplican
-- por CANT). La sincronización suma todos los renglones de la OT. Con esto se
-- va a calcular la carga de la planta por semana.
--
-- Esta migración agrega a proyectos:
--   placas, fondos, metros_canto, placas_mecanizadas (con decimales; vacío =
--   la planilla no trae el dato).
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la sincronización sigue andando sin estas columnas). Después de correrla,
-- apretar Sincronizar una vez en Proyectos → OT. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists placas numeric(10,2);
  alter table public.proyectos add column if not exists fondos numeric(10,2);
  alter table public.proyectos add column if not exists metros_canto numeric(10,2);
  alter table public.proyectos add column if not exists placas_mecanizadas numeric(10,2);

  if not exists (select 1 from pg_constraint where conname = 'proyectos_material_check') then
    alter table public.proyectos add constraint proyectos_material_check check (
      (placas is null or placas >= 0) and (fondos is null or fondos >= 0)
      and (metros_canto is null or metros_canto >= 0)
      and (placas_mecanizadas is null or placas_mecanizadas >= 0)
    );
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver cuatro filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('placas', 'fondos', 'metros_canto', 'placas_mecanizadas');
