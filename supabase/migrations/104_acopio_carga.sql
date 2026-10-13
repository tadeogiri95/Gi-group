-- 104: acopio y carga de cada OT (Órdenes de Producción, parte 10; ítem 39)
--
-- CONTEXTO: el mapa de procesos pide juntar todo lo de una obra en su sector,
-- numerar los bultos ("Bulto 3 de 12") y cargar el camión tildando una lista:
-- "el camión no sale sin la lista firmada". Si falta algo se sale con el
-- faltante anotado y una fecha, nunca se descubre en obra.
--
-- Esta migración:
--   1. bultos_ot: los bultos numerados de la OT, con su contenido y la tilde
--      de cargado (quién y cuándo).
--   2. cargas_ot: una fila por OT con el checklist de carga tildado, los
--      faltantes y su fecha, la foto de la carga completa y las dos firmas
--      (quien carga y el responsable de instalación).
--   3. RLS: misma regla por empresa que el resto (089); la app escribe las dos
--      tablas solo por /api/carga.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

-- ─── 1. bultos_ot ──────────────────────────────────────────────────────────
create table if not exists public.bultos_ot (
  id           bigserial primary key,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  ot           text not null,
  numero       integer not null check (numero between 1 and 999),
  contenido    text check (contenido is null or char_length(contenido) <= 300),
  cargado      boolean not null default false,
  cargado_por  uuid references public.empleados(id) on delete set null,
  cargado_at   timestamptz,
  creado_por   uuid references public.empleados(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint bultos_ot_numero_unico unique (empresa_id, ot, numero)
);

alter table public.bultos_ot enable row level security;
drop policy if exists tenant_isolation_auth_bultos_ot on public.bultos_ot;
create policy tenant_isolation_auth_bultos_ot on public.bultos_ot for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.bultos_ot to authenticated;
grant usage, select on sequence public.bultos_ot_id_seq to authenticated;

-- ─── 2. cargas_ot ──────────────────────────────────────────────────────────
create table if not exists public.cargas_ot (
  id                    bigserial primary key,
  empresa_id            uuid not null references public.empresa(id) on delete cascade,
  ot                    text not null,
  checklist             jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  faltantes             text check (faltantes is null or char_length(faltantes) <= 1000),
  faltantes_fecha       date,
  foto_url              text check (foto_url is null or char_length(foto_url) <= 500),
  firma_carga_por       uuid references public.empleados(id) on delete set null,
  firma_carga_at        timestamptz,
  firma_instalacion_por uuid references public.empleados(id) on delete set null,
  firma_instalacion_at  timestamptz,
  updated_at            timestamptz not null default now(),
  constraint cargas_ot_una_por_ot unique (empresa_id, ot)
);

alter table public.cargas_ot enable row level security;
drop policy if exists tenant_isolation_auth_cargas_ot on public.cargas_ot;
create policy tenant_isolation_auth_cargas_ot on public.cargas_ot for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update on public.cargas_ot to authenticated;
grant usage, select on sequence public.cargas_ot_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('bultos_ot', 'cargas_ot');  -- t, t
