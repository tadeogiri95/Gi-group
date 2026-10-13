-- 105: acta de conformidad de instalación (Órdenes de Producción, parte 11;
-- ítem 39)
--
-- CONTEXTO: el mapa de procesos cierra la obra con un acta de conformidad
-- firmada por el cliente. El instalador descarga tildando los bultos (los
-- mismos que salieron), revisa el checklist de instalación, anota los
-- pendientes y el cliente firma con el dedo en el celular. Con el acta
-- firmada la OT queda "Instalada" (o "Instalada con pendientes" hasta
-- resolverlos). Los problemas de obra van a no_conformidades (101).
--
-- Esta migración:
--   1. bultos_ot (104): tilde de descargado en obra (quién y cuándo).
--   2. actas_ot: una fila por OT con el checklist de instalación tildado,
--      las observaciones, el nombre del cliente, su firma (imagen subida por
--      /api/upload), quién la tomó (con su nombre, para el PDF) y cuándo.
--   3. pendientes_obra: lo que queda por hacer, con foto opcional, fecha de
--      resolución y la tilde de resuelto.
--   4. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/acta.
--
-- ORDEN: correr DESPUÉS de la 104 y ANTES de unir el PR que la usa. Es
-- idempotente y va en una sola transacción.

begin;

-- ─── 1. bultos_ot: descargado en obra ──────────────────────────────────────
alter table public.bultos_ot add column if not exists descargado boolean not null default false;
alter table public.bultos_ot add column if not exists descargado_por uuid references public.empleados(id) on delete set null;
alter table public.bultos_ot add column if not exists descargado_at timestamptz;

-- ─── 2. actas_ot ───────────────────────────────────────────────────────────
create table if not exists public.actas_ot (
  id              bigserial primary key,
  empresa_id      uuid not null references public.empresa(id) on delete cascade,
  ot              text not null,
  checklist       jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  observaciones   text check (observaciones is null or char_length(observaciones) <= 1000),
  cliente_nombre  text check (cliente_nombre is null or char_length(cliente_nombre) <= 120),
  firma_url       text check (firma_url is null or char_length(firma_url) <= 500),
  firmada_por     uuid references public.empleados(id) on delete set null,
  instalador      text check (instalador is null or char_length(instalador) <= 120),
  firmada_at      timestamptz,
  updated_at      timestamptz not null default now(),
  constraint actas_ot_una_por_ot unique (empresa_id, ot)
);

alter table public.actas_ot enable row level security;
drop policy if exists tenant_isolation_auth_actas_ot on public.actas_ot;
create policy tenant_isolation_auth_actas_ot on public.actas_ot for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update on public.actas_ot to authenticated;
grant usage, select on sequence public.actas_ot_id_seq to authenticated;

-- ─── 3. pendientes_obra ────────────────────────────────────────────────────
create table if not exists public.pendientes_obra (
  id            bigserial primary key,
  empresa_id    uuid not null references public.empresa(id) on delete cascade,
  ot            text not null,
  descripcion   text not null check (char_length(descripcion) between 1 and 300),
  foto_url      text check (foto_url is null or char_length(foto_url) <= 500),
  fecha         date,
  resuelto      boolean not null default false,
  resuelto_por  uuid references public.empleados(id) on delete set null,
  resuelto_at   timestamptz,
  creado_por    uuid references public.empleados(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists pendientes_obra_empresa_ot on public.pendientes_obra (empresa_id, ot);

alter table public.pendientes_obra enable row level security;
drop policy if exists tenant_isolation_auth_pendientes_obra on public.pendientes_obra;
create policy tenant_isolation_auth_pendientes_obra on public.pendientes_obra for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.pendientes_obra to authenticated;
grant usage, select on sequence public.pendientes_obra_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('actas_ot', 'pendientes_obra');  -- t, t
--   select column_name from information_schema.columns
--   where table_name = 'bultos_ot' and column_name = 'descargado';                                 -- 1 fila
