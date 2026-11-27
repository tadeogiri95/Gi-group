-- 213: Cambiar la necesidad de material de una OT desde Gypi (pedido de Tadeo, 27/11)
--
-- CONTEXTO: lo que necesita cada OT lo copia Gypi de la planilla MRP
-- (necesidades_stock, 108) y la sincronización lo vuelve a escribir cada vez.
-- Al consumir los herrajes y accesorios de una OT en tanda (📋 Traer lo que
-- necesita una OT), Tadeo quiere poder cambiar también la necesidad "por si se
-- decide hacer un cambio de último momento o por conveniencia", y que quede
-- asentado quién lo cambió, con fecha y hora.
--
-- Esta migración:
--   1. necesidades_cambios: un renglón por cada cambio (no se pisa nada): la
--      OT, el artículo, cuánto decía antes, cuánto dice ahora, el motivo, quién
--      y cuándo. Para cada OT y artículo vale el último cambio; si no hay
--      ninguno, lo que dice la planilla MRP. La sincronización no lo toca.
--   2. RLS: misma regla por empresa que el resto (089). Se escribe solo por
--      /api/stock/movimientos (acción consumir_ot).
--
-- ORDEN: se puede correr antes o después de unir el PR. Sin ella, el consumo
-- en tanda funciona igual, pero no deja cambiar la necesidad (avisa que falta
-- la 213). Es idempotente y va en un solo bloque (do $mig$ ... $mig$).
do $mig$
begin
  create table if not exists public.necesidades_cambios (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    ot               text not null check (char_length(ot) between 1 and 40),
    sku              text not null check (char_length(sku) between 1 and 60),
    nombre           text check (nombre is null or char_length(nombre) <= 200),
    cantidad_antes   numeric(14, 3),
    cantidad         numeric(14, 3) not null check (cantidad >= 0),
    motivo           text check (motivo is null or char_length(motivo) <= 300),
    empleado_id      uuid,
    empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
    created_at       timestamptz not null default now()
  );
  create index if not exists necesidades_cambios_ot
    on public.necesidades_cambios (empresa_id, ot, sku, created_at desc);

  alter table public.necesidades_cambios enable row level security;
  drop policy if exists tenant_isolation_auth_necesidades_cambios on public.necesidades_cambios;
  create policy tenant_isolation_auth_necesidades_cambios on public.necesidades_cambios for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  revoke all on public.necesidades_cambios from anon;
  grant select, insert on public.necesidades_cambios to authenticated;
  grant usage, select on sequence public.necesidades_cambios_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'necesidades_cambios';  -- t
--   select ot, sku, cantidad_antes, cantidad, empleado_nombre, created_at
--     from public.necesidades_cambios order by created_at desc limit 10;
