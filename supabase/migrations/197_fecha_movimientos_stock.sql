-- 197: fecha de cada ingreso y consumo de Materiales (pedido de Tadeo 19/11,
-- punto 6 del plan "Corregir y ordenar Finanzas, Materiales y Gantt")
--
-- CONTEXTO: hasta ahora un movimiento de stock solo guardaba cuándo se cargó
-- (created_at). Si un ingreso o un consumo se carga días después, quedaba con
-- la fecha de carga. Ahora cada movimiento tiene su propia fecha (la del día
-- en que pasó), que la oficina puede elegir al cargarlo. created_at sigue
-- guardando cuándo se cargó.
--
-- Los movimientos que ya están quedan con la fecha en que se cargaron (hora
-- argentina). Los nuevos, si no se elige otra, con la de hoy.
--
-- ORDEN: correrla antes o después de unir el PR (sin la columna Gypi carga
-- igual, con la fecha de hoy). Es idempotente y va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.movimientos_stock
    add column if not exists fecha date;

  update public.movimientos_stock
     set fecha = (created_at at time zone 'America/Argentina/Buenos_Aires')::date
   where fecha is null;

  alter table public.movimientos_stock
    alter column fecha set default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
    alter column fecha set not null;

  create index if not exists movimientos_stock_empresa_fecha_idx
    on public.movimientos_stock (empresa_id, fecha);
end
$mig$;

-- Que PostgREST vea la columna nueva sin esperar
notify pgrst, 'reload schema';
