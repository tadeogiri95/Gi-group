-- 106: artículos y stock leídos de la planilla MRP (Stock, parte 13; ítem 40)
--
-- CONTEXTO: la fábrica ya lleva su MRP en una planilla de Google (artículos,
-- ingresos, consumos, necesidades por OT, inventario con semáforo y plan de
-- compras). La planilla sigue mandando: Gypi solo copia el catálogo y el
-- stock calculado para mostrarlos en el celular e imprimir etiquetas con QR.
-- Los movimientos desde la app llegan en otra parte (14).
--
-- Esta migración:
--   1. articulos_stock: un renglón por SKU con los datos del artículo (hoja
--      ARTICULOS) y el último stock calculado (hoja INVENTARIO). Lo escribe
--      solo la sincronización (/api/stock/sync y el cron de cada mañana);
--      un SKU que dejó de estar en la planilla queda con activo = false.
--   2. RLS: misma regla por empresa que el resto (089).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.articulos_stock (
  empresa_id        uuid not null references public.empresa(id) on delete cascade,
  sku               text not null check (char_length(sku) between 1 and 60),
  nombre            text check (nombre is null or char_length(nombre) <= 200),
  division          text check (division is null or char_length(division) <= 60),
  familia           text check (familia is null or char_length(familia) <= 80),
  tipo              text check (tipo is null or char_length(tipo) <= 60),
  unidad            text check (unidad is null or char_length(unidad) <= 20),
  marca             text check (marca is null or char_length(marca) <= 80),
  color             text check (color is null or char_length(color) <= 80),
  stock             numeric(14, 3),
  necesidad         numeric(14, 3),
  disponible        numeric(14, 3),
  en_transito       numeric(14, 3),
  punto_pedido      numeric(14, 3),
  sugerido          numeric(14, 3),
  proxima_necesidad date,
  semaforo          text check (semaforo is null or char_length(semaforo) <= 40),
  activo            boolean not null default true,
  sincronizado_at   timestamptz not null default now(),
  primary key (empresa_id, sku)
);
create index if not exists articulos_stock_empresa_nombre on public.articulos_stock (empresa_id, nombre);

alter table public.articulos_stock enable row level security;
drop policy if exists tenant_isolation_auth_articulos_stock on public.articulos_stock;
create policy tenant_isolation_auth_articulos_stock on public.articulos_stock for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- La sincronización con el pase del usuario hace upsert (insert + update)
grant select, insert, update on public.articulos_stock to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'articulos_stock';  -- t
--   select count(*) from public.articulos_stock;                            -- 0 hasta sincronizar
