-- 177: Finanzas, clientes y cobros (parte F4a)
--
-- CONTEXTO: en el libro cada cliente es un nombre escrito a mano en cada
-- operación (id_entidad), con repetidos ("STOM" y "STOM SAS"). En Gypi los
-- clientes pasan a ser una lista: cada uno con sus otros nombres (alias) para
-- juntar lo que se escribió distinto, y su cuenta corriente sale de las
-- operaciones contra Deudores por Ventas.
--
-- Esta migración:
--   1. fin_clientes: nombre, CUIT, teléfono, email, notas, otros nombres
--      (alias) y si está activo (al unir dos, el que se suma queda inactivo).
--   2. fin_operaciones.cliente_id: el cliente de una venta o un cobro.
--   3. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: un cliente que no se usa se desactiva.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_clientes (
    id            bigserial primary key,
    empresa_id    uuid not null references public.empresa(id) on delete cascade,
    nombre        text not null check (char_length(nombre) between 1 and 120),
    cuit          text check (cuit is null or char_length(cuit) <= 20),
    telefono      text check (telefono is null or char_length(telefono) <= 40),
    email         text check (email is null or char_length(email) <= 120),
    notas         text check (notas is null or char_length(notas) <= 500),
    alias         text[] not null default '{}' check (cardinality(alias) <= 30),
    activo        boolean not null default true,
    unido_a       bigint references public.fin_clientes(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );
  create index if not exists fin_clientes_empresa on public.fin_clientes (empresa_id, activo);

  alter table public.fin_operaciones add column if not exists cliente_id bigint references public.fin_clientes(id) on delete set null;
  create index if not exists fin_operaciones_cliente on public.fin_operaciones (empresa_id, cliente_id) where cliente_id is not null;

  alter table public.fin_clientes enable row level security;
  drop policy if exists tenant_isolation_auth_fin_clientes on public.fin_clientes;
  create policy tenant_isolation_auth_fin_clientes on public.fin_clientes for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_clientes to authenticated;
  grant usage, select on sequence public.fin_clientes_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_clientes';  -- t
--   select column_name from information_schema.columns where table_name = 'fin_operaciones' and column_name = 'cliente_id';  -- 1 fila
