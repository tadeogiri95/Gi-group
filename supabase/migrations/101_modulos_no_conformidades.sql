-- 101: total de módulos por OT y registro de no conformidades
-- (Órdenes de Producción, parte 6; ítem 39)
--
-- CONTEXTO: el mapa de procesos de la fábrica cuenta en armado y control
-- "módulos terminados: 3 de 12", y pide registrar cada pieza no conforme
-- (sticker rojo) con su código de defecto, el puesto que la detectó, el
-- puesto de origen y la decisión del encargado.
--
-- Esta migración:
--   1. proyectos.total_modulos: cuántos módulos tiene la OT (columna
--      "Módulos" de la planilla, o cargado a mano). Lo hecho sale de la
--      cantidad que anotan los operarios en las etapas medidas en módulos.
--   2. no_conformidades: una fila por pieza (o tanda) con defecto. decision
--      queda vacía hasta que la decide el encargado: reprocesar, rehacer,
--      usar_igual o descartar. Los códigos de defecto los arma cada empresa
--      (config_sistema, clave "defectos"); acá solo se controla el formato.
--   3. RLS: misma regla por empresa que el resto (089); la app escribe
--      no_conformidades solo por /api/no-conformidades.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

-- ─── 1. proyectos.total_modulos ────────────────────────────────────────────
alter table public.proyectos add column if not exists total_modulos integer;
alter table public.proyectos drop constraint if exists chk_total_modulos;
alter table public.proyectos add constraint chk_total_modulos
  check (total_modulos is null or (total_modulos >= 0 and total_modulos <= 9999));

-- ─── 2. no_conformidades ───────────────────────────────────────────────────
create table if not exists public.no_conformidades (
  id                bigserial primary key,
  empresa_id        uuid not null references public.empresa(id) on delete cascade,
  ot                text not null,
  defecto           text not null check (defecto ~ '^[A-Z0-9]{1,4}$'),
  pieza             text check (pieza is null or char_length(pieza) <= 80),
  cantidad          integer not null default 1 check (cantidad between 1 and 9999),
  etapa_detecta     integer check (etapa_detecta is null or etapa_detecta between 1 and 999),
  etapa_origen      integer check (etapa_origen is null or etapa_origen between 1 and 999),
  nota              text check (nota is null or char_length(nota) <= 300),
  creada_por        uuid references public.empleados(id) on delete set null,
  created_at        timestamptz not null default now(),
  decision          text check (decision is null or decision in ('reprocesar', 'rehacer', 'usar_igual', 'descartar')),
  minutos_retrabajo integer check (minutos_retrabajo is null or minutos_retrabajo between 0 and 99999),
  decidida_por      uuid references public.empleados(id) on delete set null,
  decidida_at       timestamptz
);
create index if not exists no_conformidades_empresa_ot on public.no_conformidades (empresa_id, ot);
create index if not exists no_conformidades_empresa_fecha on public.no_conformidades (empresa_id, created_at desc);

alter table public.no_conformidades enable row level security;
drop policy if exists tenant_isolation_auth_no_conformidades on public.no_conformidades;
create policy tenant_isolation_auth_no_conformidades on public.no_conformidades for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.no_conformidades to authenticated;
grant usage, select on sequence public.no_conformidades_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'no_conformidades';  -- t
--   select column_name from information_schema.columns
--   where table_name = 'proyectos' and column_name = 'total_modulos';        -- 1 fila
