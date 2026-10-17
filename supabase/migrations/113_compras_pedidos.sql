-- 113: proveedores y pedidos de material (Compras, parte 20; ítem 41;
-- diseño en notes/diseno-compras.md)
--
-- CONTEXTO: hoy los jefes de taller le piden el material a Administración por
-- WhatsApp y Administración le compra a cada proveedor también por WhatsApp.
-- Ahora los jefes de taller, gerencia, dueños y Administración cargan sus
-- pedidos en Gypi (🛒 Pedir material) y Administración los junta para armar
-- las órdenes de compra (parte 21). La planilla MRP sigue mandando en qué
-- comprar: esto es el circuito del pedido.
--
-- Esta migración:
--   1. proveedores: nombre, CUIT, contacto, WhatsApp, email, plazo de entrega
--      y condición de pago. Un nombre por empresa (sin importar mayúsculas).
--      Uno que ya no se usa se da de baja (activo = false), no se borra.
--   2. pedidos_compra: un renglón por material pedido, del catálogo de la
--      planilla (sku) o escrito a mano, con cantidad, OT, para cuándo y
--      quién lo pidió. Estados: pendiente → en_oc → recibido, o anulado.
--   3. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.proveedores (
  id              bigserial primary key,
  empresa_id      uuid not null references public.empresa(id) on delete cascade,
  nombre          text not null check (char_length(nombre) between 1 and 120),
  cuit            text check (cuit is null or char_length(cuit) <= 20),
  contacto        text check (contacto is null or char_length(contacto) <= 120),
  whatsapp        text check (whatsapp is null or char_length(whatsapp) <= 30),
  email           text check (email is null or char_length(email) <= 160),
  plazo_dias      integer check (plazo_dias is null or plazo_dias between 0 and 365),
  condicion_pago  text check (condicion_pago is null or char_length(condicion_pago) <= 120),
  notas           text check (notas is null or char_length(notas) <= 300),
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists proveedores_empresa_nombre on public.proveedores (empresa_id, lower(nombre));

create table if not exists public.pedidos_compra (
  id               bigserial primary key,
  empresa_id       uuid not null references public.empresa(id) on delete cascade,
  -- Del catálogo de la planilla MRP; null si se escribió a mano
  sku              text check (sku is null or char_length(sku) between 1 and 60),
  descripcion      text not null check (char_length(descripcion) between 1 and 200),
  unidad           text check (unidad is null or char_length(unidad) <= 20),
  cantidad         numeric(14, 3) not null check (cantidad > 0 and cantidad < 10000000000),
  ot               text check (ot is null or char_length(ot) <= 40),
  para_fecha       date,
  notas            text check (notas is null or char_length(notas) <= 300),
  division         text check (division is null or char_length(division) <= 60),
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'en_oc', 'recibido', 'anulado')),
  empleado_id      uuid references public.empleados(id) on delete set null,
  empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
  anulado_por      uuid references public.empleados(id) on delete set null,
  anulado_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists pedidos_compra_empresa_estado on public.pedidos_compra (empresa_id, estado, created_at desc);

alter table public.proveedores enable row level security;
drop policy if exists tenant_isolation_auth_proveedores on public.proveedores;
create policy tenant_isolation_auth_proveedores on public.proveedores for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Sin delete: un proveedor se da de baja
grant select, insert, update on public.proveedores to authenticated;
grant usage, select on sequence public.proveedores_id_seq to authenticated;

alter table public.pedidos_compra enable row level security;
drop policy if exists tenant_isolation_auth_pedidos_compra on public.pedidos_compra;
create policy tenant_isolation_auth_pedidos_compra on public.pedidos_compra for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Sin delete: un pedido se anula
grant select, insert, update on public.pedidos_compra to authenticated;
grant usage, select on sequence public.pedidos_compra_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('proveedores', 'pedidos_compra');  -- t, t
