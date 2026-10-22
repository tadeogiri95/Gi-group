-- 125: pedidos de cotización de una orden de compra (Compras, ítem 41;
-- diseño en notes/diseno-cotizaciones.md)
--
-- CONTEXTO: el proveedor de cada renglón de "A comprar" pasa a ser opcional.
-- Lo que se arma sin proveedor queda en una orden "A cotizar" (borrador con
-- proveedor_id vacío). Esa orden se manda a cotizar a uno o varios
-- proveedores, se anota lo que contestó cada uno (total sin IVA, plazo y una
-- nota) y al elegir al ganador la orden pasa a ser de ese proveedor y sigue
-- el circuito normal (enviada → recibida).
--
-- Esta migración:
--   1. ordenes_compra_cotizaciones: a qué proveedor se le pidió cotización de
--      cada orden, cuándo y quién; lo que contestó; y cuál se eligió.
--   2. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/compras.
--
-- Armar la orden "A cotizar" no necesita esta migración; pedir cotización sí
-- (sin ella el botón avisa "migración 125").
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.ordenes_compra_cotizaciones (
    id                 bigserial primary key,
    empresa_id         uuid not null references public.empresa(id) on delete cascade,
    orden_id           bigint not null references public.ordenes_compra(id) on delete cascade,
    proveedor_id       bigint not null references public.proveedores(id) on delete cascade,
    proveedor_nombre   text not null check (char_length(proveedor_nombre) between 1 and 120),
    pedida_por         uuid references public.empleados(id) on delete set null,
    pedida_por_nombre  text check (pedida_por_nombre is null or char_length(pedida_por_nombre) <= 120),
    -- Lo que contestó el proveedor: total sin IVA en la moneda de la orden
    total              numeric(16, 2) check (total is null or total >= 0),
    plazo_dias         integer check (plazo_dias is null or (plazo_dias >= 0 and plazo_dias <= 3650)),
    nota               text check (nota is null or char_length(nota) <= 300),
    respondida_at      timestamptz,
    elegida            boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
  );
  create unique index if not exists ordenes_compra_cotizaciones_orden_proveedor on public.ordenes_compra_cotizaciones (orden_id, proveedor_id);
  create index if not exists ordenes_compra_cotizaciones_empresa on public.ordenes_compra_cotizaciones (empresa_id, orden_id);

  alter table public.ordenes_compra_cotizaciones enable row level security;
  drop policy if exists tenant_isolation_auth_ordenes_compra_cotizaciones on public.ordenes_compra_cotizaciones;
  create policy tenant_isolation_auth_ordenes_compra_cotizaciones on public.ordenes_compra_cotizaciones for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Delete: sacar un proveedor de la lista mientras la orden está a cotizar
  grant select, insert, update, delete on public.ordenes_compra_cotizaciones to authenticated;
  grant usage, select on sequence public.ordenes_compra_cotizaciones_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'ordenes_compra_cotizaciones';  -- t
