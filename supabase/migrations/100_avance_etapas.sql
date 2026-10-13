-- 100: avance de cada etapa por OT, liberación de la OT y condición de cierre
-- (Órdenes de Producción, parte 5; ítem 39)
--
-- CONTEXTO: el mapa de procesos de la fábrica pide que una OT pase de una
-- etapa a la siguiente solo con la firma del responsable, que ninguna OT
-- entre a producción sin un checklist de liberación firmado, y que cada OT
-- lleve sus "puntos críticos" a la vista del operario.
--
-- Esta migración:
--   1. avance_etapas: una fila por OT y etapa cuando alguien la marca. Sin
--      fila = pendiente. estado: terminada (la marcó quien la completó,
--      espera el OK), aprobada (firmó el responsable) o no_aplica (la etapa
--      no corresponde a esa OT, ej. corte especial).
--   2. proyectos: liberada_at / liberada_por / liberacion (lo tildado del
--      checklist) y puntos_criticos (texto).
--   3. etapas.condicion_cierre: qué tiene que cumplirse para firmar la etapa.
--   4. RLS: misma regla por empresa que el resto (089); la app escribe
--      avance_etapas solo por /api/avance.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

-- ─── 1. avance_etapas ──────────────────────────────────────────────────────
create table if not exists public.avance_etapas (
  id            bigserial primary key,
  empresa_id    uuid not null references public.empresa(id) on delete cascade,
  ot            text not null,
  etapa         integer not null check (etapa between 1 and 999),
  estado        text not null check (estado in ('terminada', 'aprobada', 'no_aplica')),
  terminada_por uuid references public.empleados(id) on delete set null,
  terminada_at  timestamptz,
  aprobada_por  uuid references public.empleados(id) on delete set null,
  aprobada_at   timestamptz,
  updated_at    timestamptz not null default now(),
  unique (empresa_id, ot, etapa)
);
create index if not exists avance_etapas_empresa_ot on public.avance_etapas (empresa_id, ot);

alter table public.avance_etapas enable row level security;
drop policy if exists tenant_isolation_auth_avance_etapas on public.avance_etapas;
create policy tenant_isolation_auth_avance_etapas on public.avance_etapas for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.avance_etapas to authenticated;
grant usage, select on sequence public.avance_etapas_id_seq to authenticated;

-- ─── 2. proyectos: liberación y puntos críticos ────────────────────────────
alter table public.proyectos add column if not exists liberada_at timestamptz;
alter table public.proyectos add column if not exists liberada_por uuid references public.empleados(id) on delete set null;
alter table public.proyectos add column if not exists liberacion jsonb;
alter table public.proyectos add column if not exists puntos_criticos text;
alter table public.proyectos drop constraint if exists chk_puntos_criticos;
alter table public.proyectos add constraint chk_puntos_criticos
  check (puntos_criticos is null or char_length(puntos_criticos) <= 2000);

-- ─── 3. etapas: condición para firmar el cierre ────────────────────────────
alter table public.etapas add column if not exists condicion_cierre text;
alter table public.etapas drop constraint if exists chk_etapas_condicion;
alter table public.etapas add constraint chk_etapas_condicion
  check (condicion_cierre is null or char_length(condicion_cierre) <= 300);

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'avance_etapas';   -- t
--   select column_name from information_schema.columns
--   where (table_name = 'proyectos' and column_name in ('liberada_at', 'liberada_por', 'liberacion', 'puntos_criticos'))
--      or (table_name = 'etapas' and column_name = 'condicion_cierre');     -- 5 filas
