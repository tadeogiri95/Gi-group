-- 117: reporte diario de instalación (seguimiento de OT por escaneo, parte
-- 24b; diseño en notes/diseno-avance-escaneo.md)
--
-- CONTEXTO: la instalación deja de cargar tiempos con "Iniciar Tarea". En su
-- lugar, el jefe de instalaciones (empleados.es_instalador, migración 116)
-- deja al final del día un reporte desde la pestaña "Instalaciones": qué
-- módulos de la OT se colocaron, qué quedó pendiente, un comentario y fotos.
-- Con eso Gypi calcula el % de instalación de la OT: cada módulo pesa por la
-- superficie de sus piezas (piezas_ot, migración 109) y un pendiente le resta
-- al módulo la superficie de las piezas que faltan, o un % fijo (1 si no se
-- dice otro).
--
-- Esta migración:
--   1. reportes_instalacion: un reporte por vez (quién, qué OT, qué día, qué
--      módulos colocó, comentario, fotos y el % que quedó la OT).
--   2. modulos_instalados: qué módulos de cada OT ya están colocados (uno por
--      módulo; sirve para no contarlo dos veces).
--   3. pendientes_obra (migración 105) suma a qué módulo le resta, las piezas
--      que faltan, el % y de qué reporte salió. Son los mismos pendientes del
--      acta: al firmarla ya aparecen.
--   4. RLS: misma regla por empresa que el resto (089); la app escribe estas
--      tablas solo por /api/instalacion.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Necesita la 105 y la 109. Es
-- idempotente y va en una sola transacción.

begin;

create table if not exists public.reportes_instalacion (
  id           bigserial primary key,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  ot           text not null,
  fecha        date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  empleado_id  uuid references public.empleados(id) on delete set null,
  modulos      text[] not null default '{}',
  comentario   text check (comentario is null or char_length(comentario) <= 1000),
  fotos        text[] not null default '{}' check (cardinality(fotos) <= 4),
  avance       numeric(5, 1) check (avance is null or avance between 0 and 100),
  created_at   timestamptz not null default now()
);
create index if not exists reportes_instalacion_empresa_fecha on public.reportes_instalacion (empresa_id, fecha desc);
create index if not exists reportes_instalacion_empresa_ot on public.reportes_instalacion (empresa_id, ot);

create table if not exists public.modulos_instalados (
  id             bigserial primary key,
  empresa_id     uuid not null references public.empresa(id) on delete cascade,
  ot             text not null,
  modulo         text not null check (char_length(modulo) between 1 and 40),
  reporte_id     bigint references public.reportes_instalacion(id) on delete set null,
  instalado_por  uuid references public.empleados(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (empresa_id, ot, modulo)
);

alter table public.pendientes_obra add column if not exists modulo text;
alter table public.pendientes_obra drop constraint if exists pendientes_obra_modulo_check;
alter table public.pendientes_obra add constraint pendientes_obra_modulo_check
  check (modulo is null or char_length(modulo) between 1 and 40);
alter table public.pendientes_obra add column if not exists piezas bigint[];
alter table public.pendientes_obra add column if not exists porcentaje numeric(5, 2);
alter table public.pendientes_obra drop constraint if exists pendientes_obra_porcentaje_check;
alter table public.pendientes_obra add constraint pendientes_obra_porcentaje_check
  check (porcentaje is null or porcentaje between 0 and 100);
alter table public.pendientes_obra add column if not exists reporte_id bigint
  references public.reportes_instalacion(id) on delete set null;

alter table public.reportes_instalacion enable row level security;
drop policy if exists tenant_isolation_auth_reportes_instalacion on public.reportes_instalacion;
create policy tenant_isolation_auth_reportes_instalacion on public.reportes_instalacion for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.reportes_instalacion to authenticated;
grant usage, select on sequence public.reportes_instalacion_id_seq to authenticated;

alter table public.modulos_instalados enable row level security;
drop policy if exists tenant_isolation_auth_modulos_instalados on public.modulos_instalados;
create policy tenant_isolation_auth_modulos_instalados on public.modulos_instalados for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.modulos_instalados to authenticated;
grant usage, select on sequence public.modulos_instalados_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('reportes_instalacion', 'modulos_instalados');  -- t, t
