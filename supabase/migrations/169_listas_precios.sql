-- 169: listas de precios de proveedores (además de facturas sueltas)
-- (costo de OT; app/lib/facturasSueltas.js y app/lib/listasPrecios.js)
--
-- CONTEXTO: Tadeo pidió (08/11) poder subir cualquier PDF o Excel con la
-- lista de precios de un proveedor, no solo facturas. Gypi reconoce el
-- artículo de cada renglón igual que en las facturas sueltas (memoria del
-- proveedor, código, nombre) y lo que no reconoce queda en "Sin asociar".
-- Una lista puede traer cientos de renglones que no son del MRP: se pueden
-- marcar "No es del MRP" para que salgan de Sin asociar.
--
-- Esta migración:
--   1. facturas_sueltas.tipo: 'factura' (como hasta ahora) o 'lista'.
--   2. facturas_sueltas_renglones.asociado_como admite 'descartado'
--      (renglón que no es un artículo del MRP; no suma precio).
--   3. facturas_sueltas.carga admite 'planilla' (leída de un Excel o CSV).
--   4. Índice para traer rápido los renglones Sin asociar.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 168). Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de
-- Supabase.

do $mig$
declare
  c record;
begin
  alter table public.facturas_sueltas
    add column if not exists tipo text not null default 'factura';

  if not exists (select 1 from pg_constraint where conname = 'facturas_sueltas_tipo_check') then
    alter table public.facturas_sueltas
      add constraint facturas_sueltas_tipo_check check (tipo in ('factura', 'lista'));
  end if;

  -- El control viejo de carga tiene nombre automático: se busca y se borra
  for c in
    select conname from pg_constraint
    where conrelid = 'public.facturas_sueltas'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mcarga\M'  -- no la de cargada_por_nombre
  loop
    execute format('alter table public.facturas_sueltas drop constraint %I', c.conname);
  end loop;

  alter table public.facturas_sueltas
    add constraint facturas_sueltas_carga_check check (carga in ('manual', 'ia', 'planilla'));

  -- El control viejo de asociado_como tiene nombre automático: se busca y se borra
  for c in
    select conname from pg_constraint
    where conrelid = 'public.facturas_sueltas_renglones'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%asociado_como%'
  loop
    execute format('alter table public.facturas_sueltas_renglones drop constraint %I', c.conname);
  end loop;

  alter table public.facturas_sueltas_renglones
    add constraint facturas_sueltas_renglones_asociado_como_check
    check (asociado_como is null or asociado_como in ('memoria', 'codigo', 'sku', 'nombre', 'manual', 'descartado'));

  create index if not exists facturas_sueltas_renglones_sin_asociar_idx
    on public.facturas_sueltas_renglones (empresa_id, factura_id)
    where sku is null and asociado_como is null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select tipo, count(*) from public.facturas_sueltas group by tipo;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.facturas_sueltas_renglones'::regclass and contype = 'c';
