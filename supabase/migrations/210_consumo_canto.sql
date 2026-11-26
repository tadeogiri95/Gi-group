-- 210: Consumo de canto desde los escaneos (pedido de Tadeo, 26/11)
--
-- CONTEXTO: en la planilla técnica cada lado del panel (L1 A, L1 B, L2 A,
-- L2 B) dice el espesor (E) y el COLOR del canto. Con el canto por lados
-- (209) cada escaneo en la etapa de canto es un lado pegado. Ahora Gypi suma
-- los metros de cada lado (L1 o L2 de la pieza) + 5 % de desperdicio, y la
-- oficina los asienta en el MRP desde Materiales → Canto usado.
--
-- Esta migración:
--   1. piezas_ot.cantos: el canto de cada lado con canto, en el orden de la
--      planilla: [{ "l": "l1a", "e": 0.45, "c": "GRAFITO", "mm": 791 }].
--   2. movimientos_stock.canto: en el consumo que asienta el canto usado, el
--      tipo de canto ("0.45|GRAFITO|18" = espesor, color, espesor de la
--      placa). Así Gypi sabe cuánto de cada tipo ya se asentó en cada OT.
--   3. canto_articulos: el artículo del MRP que la oficina eligió para cada
--      tipo de canto (Gypi lo recuerda para la próxima). RLS por empresa.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 107 y la 209).
-- Es idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor
-- SQL de Supabase.
do $mig$
begin
  alter table public.piezas_ot add column if not exists cantos jsonb;

  alter table public.movimientos_stock add column if not exists canto text;
  alter table public.movimientos_stock drop constraint if exists movimientos_stock_canto_check;
  alter table public.movimientos_stock add constraint movimientos_stock_canto_check
    check (canto is null or char_length(canto) <= 100);
  create index if not exists movimientos_stock_canto on public.movimientos_stock (empresa_id, ot)
    where canto is not null;

  create table if not exists public.canto_articulos (
    id          bigserial primary key,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    clave       text not null check (char_length(clave) between 1 and 100),
    sku         text not null check (char_length(sku) between 1 and 60),
    updated_at  timestamptz not null default now(),
    unique (empresa_id, clave)
  );

  alter table public.canto_articulos enable row level security;
  drop policy if exists tenant_isolation_auth_canto_articulos on public.canto_articulos;
  create policy tenant_isolation_auth_canto_articulos on public.canto_articulos for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  revoke all on public.canto_articulos from anon;
  grant select, insert, update, delete on public.canto_articulos to authenticated;
  grant usage, select on sequence public.canto_articulos_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'canto_articulos';  -- t
--   select count(*) from public.piezas_ot where cantos is not null;         -- sube cuando Gypi relee las planillas
