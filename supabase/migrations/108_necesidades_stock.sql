-- 108: material que necesita cada OT, leído de la planilla MRP (Stock, parte 16; ítem 40)
--
-- CONTEXTO: las arquitectas cargan en la planilla MRP (hoja
-- fact_necesidades_stock) qué material necesita cada OT. La planilla sigue
-- mandando: Gypi copia esa hoja (publicada como CSV) para mostrar, en el
-- detalle de la OT, lo necesario contra lo ya retirado desde la app.
--
-- Esta migración:
--   1. necesidades_stock: un renglón por OT y artículo, con la cantidad
--      necesaria (presupuestada menos cancelada, sumando los renglones
--      repetidos), la primera fecha requerida y si la obra está terminada.
--      La escribe solo la sincronización (botón Sincronizar y el cron de cada
--      mañana): lo que dejó de estar en la planilla se borra.
--   2. RLS: misma regla por empresa que el resto (089).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.necesidades_stock (
  empresa_id       uuid not null references public.empresa(id) on delete cascade,
  ot               text not null check (char_length(ot) between 1 and 40),
  sku              text not null check (char_length(sku) between 1 and 60),
  nombre           text check (nombre is null or char_length(nombre) <= 200),
  cantidad         numeric(14, 3) not null default 0,
  fecha            date,
  obra_terminada   boolean,
  sincronizado_at  timestamptz not null default now(),
  primary key (empresa_id, ot, sku)
);

alter table public.necesidades_stock enable row level security;
drop policy if exists tenant_isolation_auth_necesidades_stock on public.necesidades_stock;
create policy tenant_isolation_auth_necesidades_stock on public.necesidades_stock for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- La sincronización con el pase del usuario hace upsert y borra lo que ya no está
grant select, insert, update, delete on public.necesidades_stock to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'necesidades_stock';  -- t
--   select ot, count(*) from public.necesidades_stock group by ot order by ot desc limit 5;
