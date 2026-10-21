-- 121: corregir pedidos de material dejando registro (Compras, ítem 41)
--
-- CONTEXTO: un pedido de material cargado con un error (cantidad, artículo,
-- OT, fecha u observación) solo se podía anular y volver a pedir. Ahora se
-- corrige mientras está pendiente: lo puede hacer quien lo pidió o
-- Administración/gerencia, y cada corrección queda guardada con quién la
-- hizo, cuándo y qué cambió (antes → después).
--
-- Esta migración:
--   1. pedidos_compra.editado_por / editado_por_nombre / editado_at: la
--      última corrección, para mostrarla en la lista sin otra consulta.
--   2. pedidos_compra_cambios: el historial completo. Un renglón por
--      corrección con la lista de campos cambiados (jsonb). No se edita ni
--      se borra.
--   3. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- Sin la migración el botón "Editar" avisa que falta correrla.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.pedidos_compra add column if not exists editado_por uuid references public.empleados(id) on delete set null;
  alter table public.pedidos_compra add column if not exists editado_por_nombre text;
  alter table public.pedidos_compra add column if not exists editado_at timestamptz;
  alter table public.pedidos_compra drop constraint if exists pedidos_compra_editado_por_nombre_check;
  alter table public.pedidos_compra add constraint pedidos_compra_editado_por_nombre_check
    check (editado_por_nombre is null or char_length(editado_por_nombre) <= 120);

  create table if not exists public.pedidos_compra_cambios (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    pedido_id        bigint not null references public.pedidos_compra(id) on delete cascade,
    -- [{ campo, antes, despues }]
    cambios          jsonb not null,
    empleado_id      uuid references public.empleados(id) on delete set null,
    empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
    created_at       timestamptz not null default now()
  );
  create index if not exists pedidos_compra_cambios_pedido on public.pedidos_compra_cambios (empresa_id, pedido_id, created_at desc);

  alter table public.pedidos_compra_cambios enable row level security;
  drop policy if exists tenant_isolation_auth_pedidos_compra_cambios on public.pedidos_compra_cambios;
  create policy tenant_isolation_auth_pedidos_compra_cambios on public.pedidos_compra_cambios for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Solo se agrega: el registro no se corrige ni se borra
  grant select, insert on public.pedidos_compra_cambios to authenticated;
  grant usage, select on sequence public.pedidos_compra_cambios_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'pedidos_compra_cambios';  -- t
