-- 139: tipo de proyecto de cada OT elegido a mano (planificación de la
-- producción; app/lib/tipoProyecto.js)
--
-- CONTEXTO: para calcular cuántos mecanizados y gabinetes lleva una OT, Gypi
-- usa los valores por placa de su tipo (cocina, placard, vanitory…). El tipo
-- sale solo de la descripción de la OT; si gerencia lo cambia a mano en
-- Proyectos → Planificación → 📊 Carga, queda guardado acá y la
-- sincronización con la planilla no lo pisa. Vacío = automático.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el tipo automático funciona igual y la pantalla avisa que para cambiarlo a
-- mano falta la migración). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proyectos add column if not exists tipo_proyecto text;

  if not exists (select 1 from pg_constraint where conname = 'proyectos_tipo_proyecto_check') then
    alter table public.proyectos add constraint proyectos_tipo_proyecto_check
      check (tipo_proyecto is null or tipo_proyecto in (
        'puertas', 'lavadero', 'cocina', 'vestidor', 'placard', 'bano', 'rack',
        'revestimiento', 'dormitorio', 'escritorio', 'comercial', 'otros'));
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos' and column_name = 'tipo_proyecto';
