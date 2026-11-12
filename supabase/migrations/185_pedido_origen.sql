-- 185_pedido_origen.sql — De un problema a un pedido de compra (auditoría del
-- 12/11, parte 8).
--
-- CONTEXTO: un pendiente de obra, una falla de una máquina o un arreglo de un
-- vehículo que necesitaba material se anotaba, pero el pedido había que
-- hacerlo aparte en Compras y no quedaba unido al problema.
--
-- Esta migración:
--   pedidos_compra.origen y origen_id: de qué problema salió el pedido
--   (pendiente_obra, falla_maquina o arreglo_vehiculo, con su id). El
--   problema muestra en qué está su pedido.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente: se puede
-- correr más de una vez.

begin;

alter table public.pedidos_compra add column if not exists origen text;
alter table public.pedidos_compra add column if not exists origen_id bigint;
alter table public.pedidos_compra drop constraint if exists pedidos_compra_origen_check;
alter table public.pedidos_compra add constraint pedidos_compra_origen_check
  check ((origen is null and origen_id is null) or (origen in ('pendiente_obra', 'falla_maquina', 'arreglo_vehiculo') and origen_id is not null));
create index if not exists pedidos_compra_origen_idx on public.pedidos_compra (empresa_id, origen, origen_id) where origen is not null;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'pedidos_compra' and column_name in ('origen', 'origen_id');  -- 2 filas
