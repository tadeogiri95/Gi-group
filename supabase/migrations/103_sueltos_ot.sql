-- 103: hoja de sueltos y herrajes de cada OT (Órdenes de Producción, parte 9; ítem 39)
--
-- CONTEXTO: el mapa de procesos pide que técnica liste todo lo que viaja
-- suelto (maderas sin módulo, perfiles, herrajes y accesorios que van a obra)
-- para controlarlo en acopio y en la carga: "lo que no está en la planilla es
-- lo que más se olvida en la carga".
--
-- Esta migración:
--   1. sueltos_ot: un renglón por ítem suelto de la OT (tipo, código,
--      descripción, medida, cantidad y con qué va), con dos tildes: acopio y
--      carga, cada una con quién y cuándo.
--   2. RLS: misma regla por empresa que el resto (089); la app escribe
--      sueltos_ot solo por /api/sueltos.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.sueltos_ot (
  id           bigserial primary key,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  ot           text not null,
  orden        integer not null default 0,
  tipo         text check (tipo is null or char_length(tipo) <= 30),
  codigo       text check (codigo is null or char_length(codigo) <= 40),
  descripcion  text check (descripcion is null or char_length(descripcion) <= 200),
  medida       text check (medida is null or char_length(medida) <= 40),
  cantidad     numeric(10, 2) not null default 1 check (cantidad > 0 and cantidad <= 99999),
  va_con       text check (va_con is null or char_length(va_con) <= 80),
  acopio       boolean not null default false,
  acopio_por   uuid references public.empleados(id) on delete set null,
  acopio_at    timestamptz,
  carga        boolean not null default false,
  carga_por    uuid references public.empleados(id) on delete set null,
  carga_at     timestamptz,
  creado_por   uuid references public.empleados(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint chk_sueltos_ot_algo check (codigo is not null or descripcion is not null)
);
create index if not exists sueltos_ot_empresa_ot on public.sueltos_ot (empresa_id, ot, orden);

alter table public.sueltos_ot enable row level security;
drop policy if exists tenant_isolation_auth_sueltos_ot on public.sueltos_ot;
create policy tenant_isolation_auth_sueltos_ot on public.sueltos_ot for all to authenticated
  using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
grant select, insert, update, delete on public.sueltos_ot to authenticated;
grant usage, select on sequence public.sueltos_ot_id_seq to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'sueltos_ot';  -- t
