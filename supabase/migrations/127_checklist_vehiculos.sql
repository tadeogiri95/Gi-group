-- 127: checklist de mantenimiento de vehículos (Mantenimiento, parte 29;
-- ítem 43; diseño en notes/diseno-mantenimiento-vehicular.md)
--
-- CONTEXTO: el chofer o responsable de cada vehículo (y la oficina, de
-- cualquiera) hace el checklist desde el celular: fecha y hora, kilómetros,
-- combustible, y cada punto de las siete secciones (Limpieza, Fluidos,
-- Documentación, Neumáticos, ITV, Seguro, Luces) marcado Bien, Revisar, Mal o
-- No aplica, con nota y foto cuando no está bien. Al final, observaciones,
-- fotos del vehículo y firma. Se puede hacer completo o solo algunas secciones.
-- Las secciones y los puntos los edita cada empresa.
--
-- Esta migración:
--   1. flota_config: la plantilla del checklist de cada empresa (jsonb). Sin
--      fila, la app usa la plantilla de fábrica.
--   2. vehiculo_checklists: un renglón por checklist hecho, con sus puntos en
--      jsonb (sección, punto, estado, valor, nota, foto). Los arreglos de la
--      parte 31 salen de los puntos en Mal.
--   3. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/flota.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 126). Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de
-- Supabase.

do $mig$
begin
  create table if not exists public.flota_config (
    empresa_id   uuid primary key references public.empresa(id) on delete cascade,
    checklist    jsonb check (checklist is null or jsonb_typeof(checklist) = 'array'),
    updated_at   timestamptz not null default now()
  );

  create table if not exists public.vehiculo_checklists (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    vehiculo_id      bigint not null references public.vehiculos(id) on delete cascade,
    empleado_id      uuid references public.empleados(id) on delete set null,
    empleado_nombre  text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
    km               integer not null check (km >= 0 and km <= 9999999),
    combustible      text check (combustible is null or combustible in ('reserva', '1/4', '1/2', '3/4', 'lleno')),
    -- Qué secciones se revisaron (completo = todas las de la plantilla)
    secciones        jsonb not null default '[]'::jsonb check (jsonb_typeof(secciones) = 'array'),
    items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
    -- Cuántos puntos quedaron en Revisar y en Mal (para listas y alertas)
    revisar          integer not null default 0 check (revisar >= 0),
    mal              integer not null default 0 check (mal >= 0),
    observaciones    text check (observaciones is null or char_length(observaciones) <= 1000),
    fotos            jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4),
    firma_url        text check (firma_url is null or char_length(firma_url) <= 500),
    created_at       timestamptz not null default now()
  );
  create index if not exists vehiculo_checklists_vehiculo on public.vehiculo_checklists (empresa_id, vehiculo_id, created_at desc);

  alter table public.flota_config enable row level security;
  drop policy if exists tenant_isolation_auth_flota_config on public.flota_config;
  create policy tenant_isolation_auth_flota_config on public.flota_config for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update on public.flota_config to authenticated;

  alter table public.vehiculo_checklists enable row level security;
  drop policy if exists tenant_isolation_auth_vehiculo_checklists on public.vehiculo_checklists;
  create policy tenant_isolation_auth_vehiculo_checklists on public.vehiculo_checklists for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin update ni delete: un checklist hecho queda como constancia
  grant select, insert on public.vehiculo_checklists to authenticated;
  grant usage, select on sequence public.vehiculo_checklists_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('flota_config', 'vehiculo_checklists');  -- t, t
