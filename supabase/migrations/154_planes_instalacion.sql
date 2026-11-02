-- 154: plan de instalación confirmado (planificación de la instalación,
-- parte 44; diseño en notes/diseno-gantt-instalacion.md; /api/plan-instalacion)
--
-- CONTEXTO: el 🔧 Gantt de instalación es un plan vivo que se arma cada vez
-- desde hoy. Gestión lo confirma para que:
--   · cada instalador vea en su pestaña Instalaciones a qué obra va cada día
--     (📅 Mis instalaciones), y
--   · el Gantt avise cuánto se corrió cada obra contra lo confirmado.
-- Vale solo el último plan confirmado de cada división: al confirmar uno
-- nuevo, el anterior se borra.
--
-- Esta migración crea:
--   1. planes_instalacion: quién confirmó y cuándo.
--   2. plan_instalacion_items: un renglón por obra, día, medio día
--      (0 = mañana, 1 = tarde) e instalador, con las OT de esa obra.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el Gantt avisa que para confirmar falta la migración y Mis instalaciones no
-- muestra nada). Es idempotente. Va en un solo bloque (do $mig$ ... $mig$)
-- por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.planes_instalacion (
    id                 bigserial primary key,
    empresa_id         uuid not null references public.empresa(id) on delete cascade,
    division_id        text check (division_id is null or char_length(division_id) <= 60),
    confirmado_por     uuid references public.empleados(id) on delete set null,
    confirmado_nombre  text check (confirmado_nombre is null or char_length(confirmado_nombre) <= 120),
    confirmado_at      timestamptz not null default now(),
    created_at         timestamptz not null default now()
  );
  create index if not exists idx_planes_instalacion_empresa on public.planes_instalacion (empresa_id, confirmado_at desc);

  create table if not exists public.plan_instalacion_items (
    id           bigserial primary key,
    plan_id      bigint not null references public.planes_instalacion(id) on delete cascade,
    empresa_id   uuid not null references public.empresa(id) on delete cascade,
    obra         text not null check (char_length(obra) between 1 and 300),
    ots          text[] not null check (cardinality(ots) between 1 and 50),
    fecha        date not null,
    medio        smallint not null check (medio in (0, 1)),
    empleado_id  uuid references public.empleados(id) on delete set null,
    orden        integer not null default 0,
    created_at   timestamptz not null default now()
  );
  create index if not exists idx_plan_instalacion_items_plan on public.plan_instalacion_items (plan_id);
  create index if not exists idx_plan_instalacion_items_empleado on public.plan_instalacion_items (empresa_id, empleado_id, fecha);

  alter table public.planes_instalacion enable row level security;
  alter table public.plan_instalacion_items enable row level security;
  drop policy if exists tenant_isolation_auth_planes_instalacion on public.planes_instalacion;
  create policy tenant_isolation_auth_planes_instalacion on public.planes_instalacion for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  drop policy if exists tenant_isolation_auth_plan_instalacion_items on public.plan_instalacion_items;
  create policy tenant_isolation_auth_plan_instalacion_items on public.plan_instalacion_items for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, delete on public.planes_instalacion to authenticated;
  grant select, insert, delete on public.plan_instalacion_items to authenticated;
  grant usage, select on sequence public.planes_instalacion_id_seq to authenticated;
  grant usage, select on sequence public.plan_instalacion_items_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver dos filas con relrowsecurity = t:
--   select relname, relrowsecurity from pg_class
--   where relname in ('planes_instalacion', 'plan_instalacion_items');
