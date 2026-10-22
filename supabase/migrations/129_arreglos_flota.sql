-- 129: arreglos, services e historial de la flota (Mantenimiento, parte 31;
-- ítem 43; diseño en notes/diseno-mantenimiento-vehicular.md)
--
-- CONTEXTO: cada punto que el checklist marca ❌ Mal crea un arreglo pendiente
-- (con su foto y nota); la oficina puede anotar otros a mano o desde un ⚠️
-- Revisar. Un arreglo tiene prioridad (🔴 no puede circular · 🟡 arreglar
-- pronto) y un responsable. Se resuelve cargando qué se hizo, dónde (taller o
-- interno), costo, factura y fecha. Aparte se cargan services y reparaciones
-- sin checklist; un service pone al día la alerta de service (vehiculos.
-- service_fecha y service_km, de la 128). Todo junto arma el historial y el
-- costo de mantenimiento por vehículo y por mes.
--
-- Esta migración:
--   1. vehiculo_mantenimientos: services, reparaciones y arreglos resueltos,
--      con fecha, km, taller, detalle, repuestos, costo, factura y fotos.
--   2. vehiculo_arreglos: lo que hay que arreglar, de dónde salió (checklist y
--      punto), prioridad, responsable y cómo terminó (resuelto con su
--      mantenimiento, o descartado con el motivo).
--   3. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/flota.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 126, la 127 y
-- la 128). Es idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el
-- editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.vehiculo_mantenimientos (
    id              bigserial primary key,
    empresa_id      uuid not null references public.empresa(id) on delete cascade,
    vehiculo_id     bigint not null references public.vehiculos(id) on delete cascade,
    tipo            text not null check (tipo in ('service', 'reparacion', 'arreglo')),
    fecha           date not null,
    km              integer check (km is null or (km >= 0 and km <= 9999999)),
    donde           text check (donde is null or donde in ('taller', 'interno')),
    taller          text check (taller is null or char_length(taller) <= 120),
    detalle         text not null check (char_length(detalle) between 1 and 1000),
    repuestos       text check (repuestos is null or char_length(repuestos) <= 1000),
    costo           numeric(14, 2) check (costo is null or costo >= 0),
    factura_url     text check (factura_url is null or char_length(factura_url) <= 500),
    fotos           jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4),
    cargado_por     uuid references public.empleados(id) on delete set null,
    cargado_nombre  text check (cargado_nombre is null or char_length(cargado_nombre) <= 120),
    created_at      timestamptz not null default now()
  );
  create index if not exists vehiculo_mantenimientos_vehiculo on public.vehiculo_mantenimientos (empresa_id, vehiculo_id, fecha desc);

  create table if not exists public.vehiculo_arreglos (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    vehiculo_id       bigint not null references public.vehiculos(id) on delete cascade,
    checklist_id      bigint references public.vehiculo_checklists(id) on delete set null,
    seccion_nombre    text check (seccion_nombre is null or char_length(seccion_nombre) <= 60),
    punto_nombre      text check (punto_nombre is null or char_length(punto_nombre) <= 120),
    descripcion       text not null check (char_length(descripcion) between 1 and 300),
    foto              text check (foto is null or char_length(foto) <= 500),
    prioridad         text not null default 'pronto' check (prioridad in ('no_circula', 'pronto')),
    responsable_id    uuid references public.empleados(id) on delete set null,
    estado            text not null default 'pendiente' check (estado in ('pendiente', 'resuelto', 'descartado')),
    mantenimiento_id  bigint references public.vehiculo_mantenimientos(id) on delete set null,
    motivo            text check (motivo is null or char_length(motivo) <= 300),
    creado_por        uuid references public.empleados(id) on delete set null,
    created_at        timestamptz not null default now(),
    cerrado_por       uuid references public.empleados(id) on delete set null,
    cerrado_at        timestamptz
  );
  create index if not exists vehiculo_arreglos_vehiculo on public.vehiculo_arreglos (empresa_id, vehiculo_id, estado);

  alter table public.vehiculo_mantenimientos enable row level security;
  drop policy if exists tenant_isolation_auth_vehiculo_mantenimientos on public.vehiculo_mantenimientos;
  create policy tenant_isolation_auth_vehiculo_mantenimientos on public.vehiculo_mantenimientos for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, delete on public.vehiculo_mantenimientos to authenticated;
  grant usage, select on sequence public.vehiculo_mantenimientos_id_seq to authenticated;

  alter table public.vehiculo_arreglos enable row level security;
  drop policy if exists tenant_isolation_auth_vehiculo_arreglos on public.vehiculo_arreglos;
  create policy tenant_isolation_auth_vehiculo_arreglos on public.vehiculo_arreglos for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: un arreglo cargado por error se descarta con el motivo
  grant select, insert, update on public.vehiculo_arreglos to authenticated;
  grant usage, select on sequence public.vehiculo_arreglos_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('vehiculo_mantenimientos', 'vehiculo_arreglos');  -- t, t
