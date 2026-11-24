-- 207: Logística, parte 5 — abastecimiento con Compras (pedido de Tadeo, 23/11)
--
-- CONTEXTO: en un viaje de abastecimiento, la parada en un proveedor puede
-- llevar la orden de compra (OC) que se va a retirar. El chofer ve los
-- renglones de la OC que faltan llegar, anota lo que le dieron y el N° de
-- remito del proveedor, y al guardar la parada la OC queda recibida (o
-- recibida en parte) en Compras, con su ingreso de stock, como si la hubiera
-- recibido la oficina.
--
-- Esta migración (sin tablas nuevas; RLS y permisos quedan como en la 204):
--   1. logistica_paradas.orden_compra_id: la OC que se retira en la parada.
--   2. logistica_paradas.recepcion_id: la recepción que generó (para no
--      recibirla dos veces y para verla desde el viaje).
--   3. logistica_paradas.remito_proveedor: el N° de remito que dio el proveedor.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 204, la 205 y
-- las de Compras 114, 115 y 130). Es idempotente y va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.logistica_paradas add column if not exists orden_compra_id bigint references public.ordenes_compra(id) on delete set null;
  alter table public.logistica_paradas add column if not exists recepcion_id bigint references public.recepciones_compra(id) on delete set null;
  alter table public.logistica_paradas add column if not exists remito_proveedor text;

  alter table public.logistica_paradas drop constraint if exists logistica_paradas_l5_check;
  alter table public.logistica_paradas add constraint logistica_paradas_l5_check check (
    remito_proveedor is null or char_length(remito_proveedor) between 1 and 60
  );

  create index if not exists logistica_paradas_oc on public.logistica_paradas (empresa_id, orden_compra_id) where orden_compra_id is not null;
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'logistica_paradas' and column_name in ('orden_compra_id', 'recepcion_id', 'remito_proveedor');  -- 3 filas
