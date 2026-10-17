-- 115: recepción de las órdenes de compra con remito, y factura (Compras,
-- parte 22; ítem 41; diseño en notes/diseno-compras.md)
--
-- CONTEXTO: con la parte 21 Administración arma y manda las órdenes de compra
-- (OC). Ahora, cuando llega el material, los jefes de taller o Administración
-- abren la OC, marcan cuánto llegó de cada renglón y el N° de remito (y si
-- quieren una foto del remito). Cada renglón recibido de un artículo de la
-- planilla se anota como ingreso de stock (el mismo de la parte 14), así
-- pasa a la planilla MRP sin cargarlo dos veces. La factura puede llegar
-- después: Administración carga N° y fecha y, si el precio cambió (o la OC
-- es en dólares y falta el tipo de cambio), Gypi reemplaza el ingreso.
--
-- Esta migración:
--   1. recepciones_compra: una por remito, con quién la recibió y la foto.
--      Una mal cargada no se borra: se anula (y se anulan sus ingresos).
--   2. recepciones_compra_items: cuánto llegó de cada renglón de la OC y el
--      ingreso de stock que generó.
--   3. ordenes_compra: N° y fecha de factura, y tipo de cambio (OC en
--      dólares: el ingreso de stock va en pesos, como la planilla).
--   4. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

alter table public.ordenes_compra
  add column if not exists factura_numero  text check (factura_numero is null or char_length(factura_numero) <= 60),
  add column if not exists factura_fecha   date,
  add column if not exists tipo_cambio     numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0);

create table if not exists public.recepciones_compra (
  id               bigserial primary key,
  empresa_id       uuid not null references public.empresa(id) on delete cascade,
  orden_id         bigint not null references public.ordenes_compra(id) on delete cascade,
  remito           text not null check (char_length(remito) between 1 and 60),
  foto_url         text check (foto_url is null or char_length(foto_url) <= 500),
  notas            text check (notas is null or char_length(notas) <= 300),
  empleado_id      uuid references public.empleados(id) on delete set null,
  empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
  anulada          boolean not null default false,
  anulada_por      uuid references public.empleados(id) on delete set null,
  anulada_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists recepciones_compra_orden on public.recepciones_compra (orden_id);

create table if not exists public.recepciones_compra_items (
  id              bigserial primary key,
  empresa_id      uuid not null references public.empresa(id) on delete cascade,
  recepcion_id    bigint not null references public.recepciones_compra(id) on delete cascade,
  item_id         bigint not null references public.ordenes_compra_items(id) on delete cascade,
  cantidad        numeric(14, 3) not null check (cantidad > 0 and cantidad < 10000000000),
  -- El ingreso de stock (parte 14); null si el renglón no es un artículo de la planilla
  movimiento_id   bigint references public.movimientos_stock(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists recepciones_compra_items_recepcion on public.recepciones_compra_items (recepcion_id);
create index if not exists recepciones_compra_items_item on public.recepciones_compra_items (item_id);

alter table public.recepciones_compra enable row level security;
drop policy if exists tenant_isolation_auth_recepciones_compra on public.recepciones_compra;
create policy tenant_isolation_auth_recepciones_compra on public.recepciones_compra for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Sin delete: una recepción se anula
grant select, insert, update on public.recepciones_compra to authenticated;
grant usage, select on sequence public.recepciones_compra_id_seq to authenticated;

alter table public.recepciones_compra_items enable row level security;
drop policy if exists tenant_isolation_auth_recepciones_compra_items on public.recepciones_compra_items;
create policy tenant_isolation_auth_recepciones_compra_items on public.recepciones_compra_items for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update on public.recepciones_compra_items to authenticated;
grant usage, select on sequence public.recepciones_compra_items_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('recepciones_compra', 'recepciones_compra_items');  -- t, t
