-- 140: puesto de cada operario en la planta (planificación de la producción;
-- app/lib/cargaPlanta.js PUESTOS_PLANTA)
--
-- CONTEXTO: para planificar Armado con varios armadores a la vez, cada
-- operario puede tener su puesto: Corte, Canteado, Mecanizado, Armado u
-- "otra línea" (por ejemplo Puertas). Los de otra línea no cuentan para la
-- capacidad de la planificación. Se elige en Gestión de personal → editar.
-- Vacío = sin puesto (hace cualquier cosa).
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la ficha no muestra el puesto y la planificación toma a todos los operarios
-- como antes). Es idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el
-- editor SQL de Supabase.

do $mig$
begin
  alter table public.empleados add column if not exists puesto_planta text;

  if not exists (select 1 from pg_constraint where conname = 'empleados_puesto_planta_check') then
    alter table public.empleados add constraint empleados_puesto_planta_check
      check (puesto_planta is null or puesto_planta in ('corte', 'canteado', 'mecanizado', 'armado', 'otra_linea'));
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'empleados' and column_name = 'puesto_planta';
