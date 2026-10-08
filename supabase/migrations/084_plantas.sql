-- 084_plantas.sql — Núcleo modular, parte 3: plantas o sedes por empresa (ítem 36).
--
-- 1. plantas: los lugares físicos de la empresa (planta, taller, sede). Cada
--    empresa tiene exactamente una "principal", que no se puede dar de baja.
--    Las que existen hoy reciben una "Planta principal" y las nuevas la reciben
--    al registrarse (trigger). Las bajas son lógicas (activa = false).
-- 2. empleados.planta_id y geo_zonas.planta_id: a qué planta pertenece cada
--    persona y cada punto de fichaje. Se completan con la principal (y los
--    nuevos la reciben por trigger si no se indica otra), así que con una sola
--    planta nada cambia. La clave foránea compuesta
--    (planta_id, empresa_id) impide en la base asignar una planta de otra empresa.
-- Los módulos que vienen (producción, stock, mantenimiento) también cuelgan de acá.
-- Solo las usa el servidor con la service key (RLS activado, sin políticas).
-- Se puede correr más de una vez sin efectos.

create table if not exists public.plantas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  nombre     text not null check (length(btrim(nombre)) between 1 and 80),
  direccion  text check (direccion is null or length(direccion) <= 200),
  principal  boolean not null default false,
  activa     boolean not null default true,
  creado_en  timestamptz not null default now(),
  unique (id, empresa_id),
  check (activa or not principal)
);

create unique index if not exists plantas_una_principal
  on public.plantas (empresa_id) where principal;
create unique index if not exists plantas_nombre_unico
  on public.plantas (empresa_id, lower(btrim(nombre))) where activa;

-- Una principal para cada empresa que todavía no tenga
insert into public.plantas (empresa_id, nombre, principal)
select e.id, 'Planta principal', true
from public.empresa e
where not exists (select 1 from public.plantas p where p.empresa_id = e.id and p.principal);

-- Y para las que se registren de acá en adelante
create or replace function public.crear_planta_principal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.plantas (empresa_id, nombre, principal)
  values (new.id, 'Planta principal', true)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists empresa_planta_principal on public.empresa;
create trigger empresa_planta_principal
  after insert on public.empresa
  for each row execute function public.crear_planta_principal();

-- A qué planta pertenece cada persona y cada punto de fichaje
alter table public.empleados add column if not exists planta_id uuid;
alter table public.geo_zonas add column if not exists planta_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empleados_planta_fk') then
    alter table public.empleados add constraint empleados_planta_fk
      foreign key (planta_id, empresa_id) references public.plantas (id, empresa_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'geo_zonas_planta_fk') then
    alter table public.geo_zonas add constraint geo_zonas_planta_fk
      foreign key (planta_id, empresa_id) references public.plantas (id, empresa_id);
  end if;
end $$;

update public.empleados e set planta_id = p.id
from public.plantas p
where e.planta_id is null and p.empresa_id = e.empresa_id and p.principal;

update public.geo_zonas z set planta_id = p.id
from public.plantas p
where z.planta_id is null and p.empresa_id = z.empresa_id and p.principal;

-- Quien se cree sin planta (alta, importación, registro) queda en la principal
create or replace function public.asignar_planta_principal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.planta_id is null then
    select p.id into new.planta_id
    from public.plantas p
    where p.empresa_id = new.empresa_id and p.principal;
  end if;
  return new;
end $$;

drop trigger if exists empleados_planta_principal on public.empleados;
create trigger empleados_planta_principal
  before insert on public.empleados
  for each row execute function public.asignar_planta_principal();

drop trigger if exists geo_zonas_planta_principal on public.geo_zonas;
create trigger geo_zonas_planta_principal
  before insert on public.geo_zonas
  for each row execute function public.asignar_planta_principal();

create index if not exists empleados_planta_idx on public.empleados (planta_id);
create index if not exists geo_zonas_planta_idx on public.geo_zonas (planta_id);

alter table public.plantas enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.plantas from anon, authenticated;
  end if;
end $$;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select
--     (select count(*) from public.empresa)                                    as empresas,
--     (select count(*) from public.plantas where principal)                    as principales,      -- igual a empresas
--     (select count(*) from public.empleados where planta_id is null)          as empleados_sin_planta, -- 0
--     (select count(*) from public.geo_zonas where planta_id is null)          as zonas_sin_planta;     -- 0
