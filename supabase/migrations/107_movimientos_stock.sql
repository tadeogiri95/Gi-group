-- 107: movimientos de stock cargados desde la app (Stock, parte 14; ítem 40)
--
-- CONTEXTO: hasta ahora los operarios anotaban en papel lo que retiraban y el
-- dueño lo pasaba a mano al formulario de la planilla MRP. Ahora el operario
-- escanea el QR del artículo, elige la OT y pone la cantidad; la oficina
-- carga ingresos, ajustes y devoluciones. La planilla sigue mandando: estos
-- movimientos se le pasan en la parte 15 (el script de la planilla los trae).
--
-- Esta migración:
--   1. movimientos_stock: un renglón por movimiento con el artículo, la
--      cantidad, la OT, quién lo cargó (con su nombre y legajo, para la
--      planilla) y, si es un ingreso, proveedor, comprobante y precio.
--      Un movimiento mal cargado no se borra: se anula (quién y cuándo).
--   2. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/stock/movimientos.
--
-- ORDEN: correr DESPUÉS de la 106 y ANTES de unir el PR que la usa. Es
-- idempotente y va en una sola transacción.

begin;

create table if not exists public.movimientos_stock (
  id               bigserial primary key,
  empresa_id       uuid not null references public.empresa(id) on delete cascade,
  tipo             text not null check (tipo in ('consumo', 'devolucion', 'ingreso', 'ajuste')),
  sku              text not null check (char_length(sku) between 1 and 60),
  nombre           text check (nombre is null or char_length(nombre) <= 200),
  unidad           text check (unidad is null or char_length(unidad) <= 20),
  division         text check (division is null or char_length(division) <= 60),
  -- Siempre positiva, salvo un ajuste (que puede restar)
  cantidad         numeric(14, 3) not null check (cantidad <> 0 and abs(cantidad) < 10000000000 and (tipo = 'ajuste' or cantidad > 0)),
  ot               text check (ot is null or char_length(ot) <= 40),
  proveedor        text check (proveedor is null or char_length(proveedor) <= 120),
  comprobante      text check (comprobante is null or char_length(comprobante) <= 60),
  precio_unitario  numeric(14, 2) check (precio_unitario is null or precio_unitario >= 0),
  notas            text check (notas is null or char_length(notas) <= 300),
  empleado_id      uuid references public.empleados(id) on delete set null,
  legajo           integer,
  empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
  anulado          boolean not null default false,
  anulado_por      uuid references public.empleados(id) on delete set null,
  anulado_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists movimientos_stock_empresa_fecha on public.movimientos_stock (empresa_id, created_at desc);
create index if not exists movimientos_stock_empresa_ot on public.movimientos_stock (empresa_id, ot);

alter table public.movimientos_stock enable row level security;
drop policy if exists tenant_isolation_auth_movimientos_stock on public.movimientos_stock;
create policy tenant_isolation_auth_movimientos_stock on public.movimientos_stock for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
-- Sin delete: un movimiento se anula, no se borra
grant select, insert, update on public.movimientos_stock to authenticated;
grant usage, select on sequence public.movimientos_stock_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'movimientos_stock';  -- t
