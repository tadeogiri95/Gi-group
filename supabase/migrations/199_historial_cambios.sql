-- 199: historial de cambios de cada operación de Finanzas y de cada
-- movimiento de Materiales (pedido de Tadeo 19/11, punto 12 del plan
-- "Corregir y ordenar Finanzas, Materiales y Gantt")
--
-- CONTEXTO: hasta ahora, corregir una operación la dejaba anulada
-- ("corregida") y cargaba otra nueva. Desde esta migración se corrige en su
-- lugar: la operación es la misma (no cambia de número, sigue unida a su
-- extracto, su orden o su plazo fijo) y cada cambio queda anotado.
--
-- historial = [{ at, por, accion: "corregida", cambios: [{ campo, antes, despues }] }]
-- (hasta 200 entradas; las arma app/lib/historialCambios.js). La anulación
-- se sigue guardando como hoy (anulada_at / anulado_at y quién) y se muestra
-- en el mismo historial.
--
-- En Materiales el movimiento corregido queda anulado y se carga uno nuevo
-- (así la planilla MRP borra el renglón viejo y escribe el nuevo); los dos
-- quedan unidos por su historial.
--
-- ORDEN: correrla antes de unir el PR (sin la columna, Gypi corrige como
-- antes: anula y carga una nueva, y avisa). Es idempotente y va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.fin_operaciones
    add column if not exists historial jsonb not null default '[]'::jsonb;
  alter table public.movimientos_stock
    add column if not exists historial jsonb not null default '[]'::jsonb;

  if not exists (select 1 from pg_constraint where conname = 'fin_operaciones_historial_lista') then
    alter table public.fin_operaciones
      add constraint fin_operaciones_historial_lista
      check (jsonb_typeof(historial) = 'array' and jsonb_array_length(historial) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'movimientos_stock_historial_lista') then
    alter table public.movimientos_stock
      add constraint movimientos_stock_historial_lista
      check (jsonb_typeof(historial) = 'array' and jsonb_array_length(historial) <= 200);
  end if;
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';
