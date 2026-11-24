-- 204: Logística, parte 2 — viajes y sus paradas (pedido de Tadeo, 23/11)
--
-- CONTEXTO: el Dueño (o un supervisor u Oficina) arma cada viaje: de qué tipo
-- es (abastecimiento, interno, entrega o devolución), qué día, en qué
-- vehículo de Flota, quién maneja, desde dónde sale y las paradas en orden.
-- Gypi ordena las paradas por cercanía o se mueven a mano, y arma el
-- recorrido en Google Maps. En la parte 3 el chofer las va cumpliendo.
--
-- Esta migración:
--   1. logistica_viajes: un viaje con número correlativo por empresa.
--   2. logistica_paradas: las paradas del viaje en orden. Cada una guarda una
--      copia del nombre, la dirección y el pin al armar el viaje (si después
--      cambia la dirección de la obra, el viaje ya armado no se mueve), y las
--      OT que van a esa parada.
--   3. RLS: misma regla por empresa que el resto; la app escribe solo por
--      /api/logistica.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 203). Es
-- idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.
do $mig$
begin
  create table if not exists public.logistica_viajes (
    id              bigserial primary key,
    empresa_id      uuid not null references public.empresa(id) on delete cascade,
    numero          integer not null check (numero > 0),
    tipo            text not null check (tipo in ('abastecimiento', 'interno', 'distribucion', 'devolucion')),
    fecha           date not null,
    hora            time,
    estado          text not null default 'planificado' check (estado in ('planificado', 'en_camino', 'terminado', 'cancelado')),
    vehiculo_id     bigint references public.vehiculos(id) on delete set null,
    chofer_id       uuid references public.empleados(id) on delete set null,
    origen_id       bigint references public.logistica_lugares(id) on delete set null,
    vuelve          boolean not null default true,
    notas           text check (notas is null or char_length(notas) <= 500),
    motivo_cancelado text check (motivo_cancelado is null or char_length(motivo_cancelado) <= 300),
    creado_por      uuid references public.empleados(id) on delete set null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint logistica_viajes_numero_unico unique (empresa_id, numero)
  );
  create index if not exists logistica_viajes_fecha on public.logistica_viajes (empresa_id, fecha desc);
  create index if not exists logistica_viajes_chofer on public.logistica_viajes (empresa_id, chofer_id, fecha);

  create table if not exists public.logistica_paradas (
    id          bigserial primary key,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    viaje_id    bigint not null references public.logistica_viajes(id) on delete cascade,
    orden       integer not null check (orden between 1 and 50),
    lugar_id    bigint references public.logistica_lugares(id) on delete set null,
    ots         text[] not null default '{}' check (cardinality(ots) <= 50),
    nombre      text not null check (char_length(nombre) between 1 and 200),
    cliente     text check (cliente is null or char_length(cliente) <= 200),
    direccion   text check (direccion is null or char_length(direccion) <= 300),
    lat         numeric(9, 6) check (lat is null or lat between -90 and 90),
    lng         numeric(9, 6) check (lng is null or lng between -180 and 180),
    accion      text not null default 'entregar' check (accion in ('entregar', 'retirar', 'entregar_retirar')),
    notas       text check (notas is null or char_length(notas) <= 500),
    estado      text not null default 'pendiente' check (estado in ('pendiente', 'entregado', 'parcial', 'rechazado', 'no_visitado')),
    created_at  timestamptz not null default now()
  );
  create index if not exists logistica_paradas_viaje on public.logistica_paradas (viaje_id, orden);

  alter table public.logistica_viajes enable row level security;
  drop policy if exists tenant_isolation_auth_logistica_viajes on public.logistica_viajes;
  create policy tenant_isolation_auth_logistica_viajes on public.logistica_viajes for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: un viaje se cancela (queda con su motivo)
  grant select, insert, update on public.logistica_viajes to authenticated;
  grant usage, select on sequence public.logistica_viajes_id_seq to authenticated;

  alter table public.logistica_paradas enable row level security;
  drop policy if exists tenant_isolation_auth_logistica_paradas on public.logistica_paradas;
  create policy tenant_isolation_auth_logistica_paradas on public.logistica_paradas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Con delete: mientras el viaje está planificado, sus paradas se reescriben
  grant select, insert, update, delete on public.logistica_paradas to authenticated;
  grant usage, select on sequence public.logistica_paradas_id_seq to authenticated;
end
$mig$;

-- Que PostgREST vea las tablas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('logistica_viajes', 'logistica_paradas');  -- t, t
