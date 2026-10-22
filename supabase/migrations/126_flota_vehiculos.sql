-- 126: flota de vehículos y sus papeles (Mantenimiento, parte 28; ítem 43;
-- diseño en notes/diseno-mantenimiento-vehicular.md)
--
-- CONTEXTO: la empresa carga sus vehículos en Planta → Flota, con sus datos,
-- su responsable (el chofer habitual) y sus papeles con vencimiento (seguro,
-- ITV, cédula, título, patente, matafuego y otros). Gypi muestra un semáforo
-- por vehículo: 🔴 vencido, 🟡 vence pronto, ✅ al día. Los checklists de
-- mantenimiento (parte 29), las alertas por push (parte 30) y los arreglos
-- (parte 31) vienen después y usan estas tablas.
--
-- Esta migración:
--   1. vehiculos: patente (una por empresa), tipo, marca, modelo, año, color,
--      motor, chasis, kilómetros, combustible, foto, división y responsable.
--      Uno que ya no se usa se da de baja (activo = false), no se borra.
--   2. vehiculo_papeles: un renglón por papel. Renovar un papel agrega uno
--      nuevo y el anterior queda como historial; el vigente es el último.
--   3. empleados: categoría y vencimiento de la licencia de conducir.
--   4. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/flota.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.vehiculos (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    patente           text not null check (char_length(patente) between 2 and 12),
    tipo              text not null default 'utilitario' check (tipo in ('auto', 'utilitario', 'camioneta', 'camion', 'acoplado', 'autoelevador', 'otro')),
    marca             text check (marca is null or char_length(marca) <= 60),
    modelo            text check (modelo is null or char_length(modelo) <= 80),
    anio              integer check (anio is null or anio between 1950 and 2100),
    color             text check (color is null or char_length(color) <= 40),
    motor             text check (motor is null or char_length(motor) <= 40),
    chasis            text check (chasis is null or char_length(chasis) <= 40),
    km                integer check (km is null or (km >= 0 and km <= 9999999)),
    km_at             timestamptz,
    combustible       text check (combustible is null or combustible in ('nafta', 'gasoil', 'gnc', 'electrico', 'otro')),
    foto_url          text check (foto_url is null or char_length(foto_url) <= 500),
    division          text check (division is null or char_length(division) <= 60),
    responsable_id    uuid references public.empleados(id) on delete set null,
    notas             text check (notas is null or char_length(notas) <= 500),
    activo            boolean not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  create unique index if not exists vehiculos_empresa_patente on public.vehiculos (empresa_id, upper(patente));
  create index if not exists vehiculos_responsable on public.vehiculos (empresa_id, responsable_id);

  create table if not exists public.vehiculo_papeles (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    vehiculo_id       bigint not null references public.vehiculos(id) on delete cascade,
    tipo              text not null check (tipo in ('seguro', 'itv', 'cedula', 'titulo', 'patente', 'matafuego', 'otro')),
    -- Para "otro": qué papel es (RUTA, permiso de carga, etc.)
    nombre            text check (nombre is null or char_length(nombre) <= 80),
    numero            text check (numero is null or char_length(numero) <= 60),
    -- Seguro: desde cuándo; ITV: fecha de la revisión
    fecha             date,
    vencimiento       date,
    compania          text check (compania is null or char_length(compania) <= 80),
    cobertura         text check (cobertura is null or char_length(cobertura) <= 120),
    -- ITV: apto, condicional (60 días para arreglar) o rechazado (30 días)
    resultado         text check (resultado is null or resultado in ('apto', 'condicional', 'rechazado')),
    -- Cédula: a quién está autorizada; cualquier papel: una nota
    detalle           text check (detalle is null or char_length(detalle) <= 300),
    fotos             jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4),
    cargado_por       uuid references public.empleados(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  create index if not exists vehiculo_papeles_vehiculo on public.vehiculo_papeles (empresa_id, vehiculo_id, tipo, created_at desc);

  alter table public.empleados add column if not exists licencia_categoria text check (licencia_categoria is null or char_length(licencia_categoria) <= 30);
  alter table public.empleados add column if not exists licencia_vencimiento date;

  alter table public.vehiculos enable row level security;
  drop policy if exists tenant_isolation_auth_vehiculos on public.vehiculos;
  create policy tenant_isolation_auth_vehiculos on public.vehiculos for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: un vehículo se da de baja
  grant select, insert, update on public.vehiculos to authenticated;
  grant usage, select on sequence public.vehiculos_id_seq to authenticated;

  alter table public.vehiculo_papeles enable row level security;
  drop policy if exists tenant_isolation_auth_vehiculo_papeles on public.vehiculo_papeles;
  create policy tenant_isolation_auth_vehiculo_papeles on public.vehiculo_papeles for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Delete: borrar un papel cargado por error
  grant select, insert, update, delete on public.vehiculo_papeles to authenticated;
  grant usage, select on sequence public.vehiculo_papeles_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('vehiculos', 'vehiculo_papeles');  -- t, t
--   select column_name from information_schema.columns where table_name = 'empleados' and column_name like 'licencia_%';  -- 2 filas
