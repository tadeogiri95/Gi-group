-- 114: órdenes de compra por proveedor (Compras, parte 21; ítem 41; diseño
-- en notes/diseno-compras.md)
--
-- CONTEXTO: con la parte 20 los jefes de taller cargan pedidos de material.
-- Ahora Administración (sin división asignada), gerencia y dueños juntan esos
-- pedidos y lo que la planilla MRP marca para comprar, y Gypi arma una orden
-- de compra (OC) por proveedor, con el último precio sin IVA y la cantidad
-- redondeada al múltiplo. La OC se manda en PDF y por WhatsApp o email.
--
-- Esta migración:
--   1. articulos_stock: último precio, proveedor principal (hoja ARTICULOS) y
--      múltiplo y plazo de entrega (hoja INVENTARIO), que trae la
--      sincronización diaria de la planilla.
--   2. ordenes_compra: una por proveedor, numerada por empresa (N° 1, 2…),
--      en pesos o dólares. Estados: borrador → enviada → recibida_parcial →
--      recibida (parte 22), o anulada. No se borran: se anulan.
--   3. ordenes_compra_items: un renglón por material, con el pedido del jefe
--      de taller que cubre (si vino de uno). En borrador un renglón se puede
--      quitar.
--   4. pedidos_compra.orden_id: en qué OC quedó cada pedido.
--   5. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- ORDEN: correr ANTES de unir el PR que la usa (la sincronización de Stock
-- ya escribe las columnas nuevas). Es idempotente y va en una sola
-- transacción.

begin;

alter table public.articulos_stock
  add column if not exists ultimo_precio        numeric(16, 4),
  add column if not exists proveedor_principal  text,
  add column if not exists multiplo             numeric(14, 3),
  add column if not exists plazo_dias           integer;

create table if not exists public.ordenes_compra (
  id                 bigserial primary key,
  empresa_id         uuid not null references public.empresa(id) on delete cascade,
  numero             integer not null check (numero > 0),
  proveedor_id       bigint references public.proveedores(id) on delete set null,
  proveedor_nombre   text not null check (char_length(proveedor_nombre) between 1 and 120),
  moneda             text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  estado             text not null default 'borrador' check (estado in ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'anulada')),
  fecha_prometida    date,
  notas              text check (notas is null or char_length(notas) <= 500),
  creada_por         uuid references public.empleados(id) on delete set null,
  creada_por_nombre  text check (creada_por_nombre is null or char_length(creada_por_nombre) <= 120),
  enviada_at         timestamptz,
  anulada_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists ordenes_compra_empresa_numero on public.ordenes_compra (empresa_id, numero);
create index if not exists ordenes_compra_empresa_estado on public.ordenes_compra (empresa_id, estado, created_at desc);

create table if not exists public.ordenes_compra_items (
  id                 bigserial primary key,
  empresa_id         uuid not null references public.empresa(id) on delete cascade,
  orden_id           bigint not null references public.ordenes_compra(id) on delete cascade,
  sku                text check (sku is null or char_length(sku) between 1 and 60),
  descripcion        text not null check (char_length(descripcion) between 1 and 200),
  unidad             text check (unidad is null or char_length(unidad) <= 20),
  cantidad           numeric(14, 3) not null check (cantidad > 0 and cantidad < 10000000000),
  -- Sin IVA, en la moneda de la OC
  precio_unitario    numeric(16, 4) check (precio_unitario is null or precio_unitario >= 0),
  -- Lo carga la recepción (parte 22)
  cantidad_recibida  numeric(14, 3) not null default 0 check (cantidad_recibida >= 0),
  ot                 text check (ot is null or char_length(ot) <= 40),
  pedido_id          bigint references public.pedidos_compra(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists ordenes_compra_items_orden on public.ordenes_compra_items (orden_id);

alter table public.pedidos_compra
  add column if not exists orden_id bigint references public.ordenes_compra(id) on delete set null;

alter table public.ordenes_compra enable row level security;
drop policy if exists tenant_isolation_auth_ordenes_compra on public.ordenes_compra;
create policy tenant_isolation_auth_ordenes_compra on public.ordenes_compra for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Sin delete: una OC se anula
grant select, insert, update on public.ordenes_compra to authenticated;
grant usage, select on sequence public.ordenes_compra_id_seq to authenticated;

alter table public.ordenes_compra_items enable row level security;
drop policy if exists tenant_isolation_auth_ordenes_compra_items on public.ordenes_compra_items;
create policy tenant_isolation_auth_ordenes_compra_items on public.ordenes_compra_items for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Delete: quitar un renglón de una OC en borrador
grant select, insert, update, delete on public.ordenes_compra_items to authenticated;
grant usage, select on sequence public.ordenes_compra_items_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('ordenes_compra', 'ordenes_compra_items');  -- t, t
--   select column_name from information_schema.columns where table_name = 'articulos_stock' and column_name in ('ultimo_precio', 'proveedor_principal', 'multiplo', 'plazo_dias');  -- 4 filas
