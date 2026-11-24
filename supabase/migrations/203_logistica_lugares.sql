-- 203: Logística, parte 1 — módulo, libreta de Lugares y dirección de la obra
-- en cada OT (pedido de Tadeo, 23/11)
--
-- CONTEXTO: el módulo de Logística registra los viajes de abastecimiento,
-- internos y de entrega, con remito firmado y recorrido en Google Maps. Para
-- armar un viaje hace falta saber dónde queda cada lugar, y hoy ninguna tabla
-- guarda direcciones (la obra de la OT es solo un texto).
--
-- Esta migración:
--   1. modulos: suma "logistica" (viene con las OT y se apaga aparte).
--   2. logistica_lugares: planta, depósitos, proveedores, clientes y otros,
--      cada uno con su dirección y su pin (lat/lng). No se borran: se dan de
--      baja (los viajes los van a nombrar).
--   3. proyectos: dirección y pin de la obra de cada OT. La sincronización de
--      la planilla no toca estas columnas.
--   4. RLS: misma regla por empresa que el resto; la app escribe solo por
--      /api/logistica.
--
-- ORDEN: correrla ANTES de unir el PR que la usa. Es idempotente y va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  insert into public.modulos (id, nombre, descripcion, disponible, orden) values
    ('logistica', 'Logística', 'Viajes de abastecimiento, internos y de entrega, remitos firmados y recorridos.', true, 69)
  on conflict (id) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion,
        disponible = excluded.disponible, orden = excluded.orden;

  create table if not exists public.logistica_lugares (
    id            bigserial primary key,
    empresa_id    uuid not null references public.empresa(id) on delete cascade,
    nombre        text not null check (char_length(nombre) between 1 and 120),
    tipo          text not null default 'otro' check (tipo in ('planta', 'deposito', 'proveedor', 'cliente', 'otro')),
    direccion     text check (direccion is null or char_length(direccion) <= 300),
    lat           numeric(9, 6) check (lat is null or lat between -90 and 90),
    lng           numeric(9, 6) check (lng is null or lng between -180 and 180),
    proveedor_id  bigint references public.proveedores(id) on delete set null,
    contacto      text check (contacto is null or char_length(contacto) <= 120),
    telefono      text check (telefono is null or char_length(telefono) <= 40),
    horario       text check (horario is null or char_length(horario) <= 120),
    notas         text check (notas is null or char_length(notas) <= 500),
    activo        boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );
  create index if not exists logistica_lugares_empresa on public.logistica_lugares (empresa_id, activo, nombre);

  alter table public.logistica_lugares enable row level security;
  drop policy if exists tenant_isolation_auth_logistica_lugares on public.logistica_lugares;
  create policy tenant_isolation_auth_logistica_lugares on public.logistica_lugares for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: un lugar se da de baja
  grant select, insert, update on public.logistica_lugares to authenticated;
  grant usage, select on sequence public.logistica_lugares_id_seq to authenticated;

  alter table public.proyectos
    add column if not exists direccion text check (direccion is null or char_length(direccion) <= 300),
    add column if not exists lat numeric(9, 6) check (lat is null or lat between -90 and 90),
    add column if not exists lng numeric(9, 6) check (lng is null or lng between -180 and 180);
end
$mig$;

-- Que PostgREST vea la tabla y las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'logistica_lugares';  -- t
--   select disponible from public.modulos where id = 'logistica';  -- t
--   select column_name from information_schema.columns where table_name = 'proyectos' and column_name in ('direccion', 'lat', 'lng');
