-- 132: maquinaria y su plan de mantenimiento (Mantenimiento, parte 33; ítem
-- 43; diseño en notes/diseno-menu-y-mantenimiento.md)
--
-- CONTEXTO: la empresa carga sus máquinas en Mantenimiento → Maquinaria, con
-- su criticidad (A, B, C), su horómetro si tiene, y su plan: una lista de
-- tareas (cada X días o cada X horas de uso, lo que pase primero) con su
-- checklist, su aviso de seguridad y sus insumos. Gypi muestra un semáforo por
-- tarea y por máquina: 🔴 vencida, 🟡 toca pronto, ✅ al día. Hacer una tarea
-- deja un registro y la pone al día. Los responsables de mantenimiento
-- (parte 34) y las fallas (parte 35) vienen después y usan estas tablas.
--
-- Esta migración:
--   1. maquinas: código (uno por empresa), nombre, tipo, marca, modelo, serie,
--      año, ubicación, división, foto, manual, criticidad, horómetro, servicio
--      técnico y estado. Una que ya no se usa se da de baja (activo = false).
--   2. maquina_tareas: el plan de cada máquina. Una tarea que se saca queda
--      con activa = false (sus registros siguen en el historial).
--   3. maquina_registros: cada tarea hecha, con sus puntos en jsonb.
--   4. Catálogo: el módulo Maquinaria (viene con las OT y se apaga aparte).
--   5. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/maquinaria.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.maquinas (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    codigo            text not null check (char_length(codigo) between 1 and 20),
    nombre            text not null check (char_length(nombre) between 1 and 80),
    tipo              text not null default 'otra' check (char_length(tipo) <= 30),
    marca             text check (marca is null or char_length(marca) <= 60),
    modelo            text check (modelo is null or char_length(modelo) <= 80),
    serie             text check (serie is null or char_length(serie) <= 60),
    anio              integer check (anio is null or anio between 1950 and 2100),
    ubicacion         text check (ubicacion is null or char_length(ubicacion) <= 80),
    division          text check (division is null or char_length(division) <= 60),
    foto_url          text check (foto_url is null or char_length(foto_url) <= 500),
    manual_url        text check (manual_url is null or char_length(manual_url) <= 500),
    -- A: si se para, se para la producción · B: importante · C: se puede esperar
    criticidad        text not null default 'B' check (criticidad in ('A', 'B', 'C')),
    con_horometro     boolean not null default false,
    horas             integer check (horas is null or (horas >= 0 and horas <= 9999999)),
    horas_at          timestamptz,
    servicio_tecnico  text check (servicio_tecnico is null or char_length(servicio_tecnico) <= 80),
    servicio_telefono text check (servicio_telefono is null or char_length(servicio_telefono) <= 40),
    estado            text not null default 'en_servicio' check (estado in ('en_servicio', 'parada', 'fuera_de_servicio')),
    notas             text check (notas is null or char_length(notas) <= 500),
    activo            boolean not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  create unique index if not exists maquinas_empresa_codigo on public.maquinas (empresa_id, upper(codigo));

  create table if not exists public.maquina_tareas (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    maquina_id        bigint not null references public.maquinas(id) on delete cascade,
    nombre            text not null check (char_length(nombre) between 1 and 80),
    -- Cada cuánto: en días, en horas de uso o las dos (lo que pase primero)
    cada_dias         integer check (cada_dias is null or cada_dias between 1 and 3650),
    cada_horas        integer check (cada_horas is null or cada_horas between 1 and 100000),
    aviso_dias        integer not null default 0 check (aviso_dias between 0 and 365),
    aviso_horas       integer not null default 0 check (aviso_horas between 0 and 100000),
    -- Los puntos del checklist: [{ id, nombre, valor (unidad o null) }]
    checklist         jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 40),
    quien             text not null default 'interno' check (quien in ('interno', 'externo')),
    duracion_min      integer check (duracion_min is null or duracion_min between 1 and 10000),
    parar_maquina     boolean not null default true,
    seguridad         text check (seguridad is null or char_length(seguridad) <= 300),
    insumos           text check (insumos is null or char_length(insumos) <= 300),
    -- Desde cuándo se cuenta: la última vez que se hizo o, sin registro, el alta
    ultima_fecha      date,
    ultima_horas      integer check (ultima_horas is null or ultima_horas >= 0),
    horas_base        integer check (horas_base is null or horas_base >= 0),
    orden             integer not null default 0,
    activa            boolean not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint maquina_tareas_frecuencia check (cada_dias is not null or cada_horas is not null)
  );
  create index if not exists maquina_tareas_maquina on public.maquina_tareas (empresa_id, maquina_id, orden);

  create table if not exists public.maquina_registros (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    maquina_id        bigint not null references public.maquinas(id) on delete cascade,
    tarea_id          bigint references public.maquina_tareas(id) on delete set null,
    -- El nombre de la tarea al hacerla: el historial no cambia si después se edita
    tarea_nombre      text not null check (char_length(tarea_nombre) <= 80),
    fecha             date not null,
    horas             integer check (horas is null or (horas >= 0 and horas <= 9999999)),
    items             jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
    revisar           integer not null default 0,
    mal               integer not null default 0,
    seguridad_ok      boolean not null default false,
    observaciones     text check (observaciones is null or char_length(observaciones) <= 1000),
    fotos             jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4),
    firma_url         text check (firma_url is null or char_length(firma_url) <= 500),
    empleado_id       uuid references public.empleados(id) on delete set null,
    empleado_nombre   text check (empleado_nombre is null or char_length(empleado_nombre) <= 120),
    created_at        timestamptz not null default now()
  );
  create index if not exists maquina_registros_maquina on public.maquina_registros (empresa_id, maquina_id, fecha desc);

  insert into public.modulos (id, nombre, descripcion, disponible, orden) values
    ('maquinaria', 'Maquinaria', 'Máquinas, plan de mantenimiento, checklists y alertas.', true, 68)
  on conflict (id) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion,
        disponible = excluded.disponible, orden = excluded.orden;

  alter table public.maquinas enable row level security;
  drop policy if exists tenant_isolation_auth_maquinas on public.maquinas;
  create policy tenant_isolation_auth_maquinas on public.maquinas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: una máquina se da de baja
  grant select, insert, update on public.maquinas to authenticated;
  grant usage, select on sequence public.maquinas_id_seq to authenticated;

  alter table public.maquina_tareas enable row level security;
  drop policy if exists tenant_isolation_auth_maquina_tareas on public.maquina_tareas;
  create policy tenant_isolation_auth_maquina_tareas on public.maquina_tareas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: una tarea que se saca queda inactiva
  grant select, insert, update on public.maquina_tareas to authenticated;
  grant usage, select on sequence public.maquina_tareas_id_seq to authenticated;

  alter table public.maquina_registros enable row level security;
  drop policy if exists tenant_isolation_auth_maquina_registros on public.maquina_registros;
  create policy tenant_isolation_auth_maquina_registros on public.maquina_registros for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert on public.maquina_registros to authenticated;
  grant usage, select on sequence public.maquina_registros_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('maquinas', 'maquina_tareas', 'maquina_registros');  -- t, t, t
--   select disponible from public.modulos where id = 'maquinaria';  -- t
