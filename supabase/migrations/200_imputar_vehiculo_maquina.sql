-- 200: imputar una operación de Finanzas a un vehículo o a una máquina
-- (pedido de Tadeo 19/11, punto 13 del plan "Corregir y ordenar Finanzas,
-- Materiales y Gantt")
--
-- CONTEXTO: Finanzas → Movimientos deja tildar una o varias operaciones e
-- imputarlas después a un cliente, un proveedor, una OT, un centro de costo,
-- una cuenta, una caja, un vehículo o una máquina. Los cuatro primeros ya
-- tenían columna; esta migración suma vehículo y máquina. Lo imputado a un
-- vehículo o a una máquina se ve en su ficha de Flota o de Maquinaria
-- (combustible, seguros, patentes, repuestos…).
--
-- ORDEN: correrla antes de unir el PR (sin las columnas, Gypi imputa todo
-- menos vehículo y máquina, y avisa). Es idempotente y va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.fin_operaciones
    add column if not exists vehiculo_id bigint references public.vehiculos(id) on delete set null;
  alter table public.fin_operaciones
    add column if not exists maquina_id bigint references public.maquinas(id) on delete set null;

  create index if not exists fin_operaciones_vehiculo on public.fin_operaciones (empresa_id, vehiculo_id) where vehiculo_id is not null;
  create index if not exists fin_operaciones_maquina on public.fin_operaciones (empresa_id, maquina_id) where maquina_id is not null;
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';
