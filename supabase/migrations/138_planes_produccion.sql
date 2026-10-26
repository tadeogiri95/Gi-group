-- 138: plan de producción guardado (planificación de la producción, parte 41;
-- diseño en notes/diseno-planificacion-produccion.md)
--
-- CONTEXTO: gerencia arma el plan en Proyectos → Planificación → 📊 Carga
-- ("Ordenar automáticamente") y lo guarda. Mientras es borrador lo ve solo
-- gerencia; al confirmarlo, la planta lo ve en solo lectura (📅 Plan de la
-- semana en el Inicio de los operarios de la división y en el Tablero).
-- La columna SEMANA de la planilla sigue siendo la fecha de entrega: el plan
-- no la cambia.
--
-- Esta migración crea:
--   1. planes_produccion: un plan por empresa y período (desde/hasta), con su
--      estado (borrador o confirmado), el resumen (horas que hacen falta,
--      horas de la planta, horas extra, días extra y lo que pasa al período
--      siguiente) y quién lo armó y confirmó.
--   2. plan_produccion_items: qué OT y qué etapa toca cada día y con cuántas
--      horas (de reloj). Se reemplazan enteros cada vez que se guarda el plan.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- la pantalla avisa que falta). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.planes_produccion (
    id                 bigserial primary key,
    empresa_id         uuid not null references public.empresa(id) on delete cascade,
    division_id        text,
    tipo               text not null default 'semana' check (tipo in ('semana', 'mes')),
    desde              date not null,
    hasta              date not null,
    estado             text not null default 'borrador' check (estado in ('borrador', 'confirmado')),
    horas_necesarias   numeric(10, 2),
    horas_disponibles  numeric(10, 2),
    horas_extra        numeric(10, 2),
    dias_extra         jsonb not null default '[]'::jsonb,
    pendientes         jsonb not null default '[]'::jsonb,
    creado_por         uuid references public.empleados(id) on delete set null,
    confirmado_por     uuid references public.empleados(id) on delete set null,
    confirmado_at      timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    check (hasta >= desde and hasta - desde <= 62),
    unique (empresa_id, desde, hasta)
  );
  create index if not exists idx_planes_produccion_empresa_fechas
    on public.planes_produccion (empresa_id, desde, hasta);

  create table if not exists public.plan_produccion_items (
    id          bigserial primary key,
    plan_id     bigint not null references public.planes_produccion(id) on delete cascade,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    ot          text not null check (char_length(ot) between 1 and 40),
    etapa       text not null check (etapa in ('corte', 'canteado', 'mecanizado', 'armado')),
    fecha       date not null,
    horas       numeric(8, 2) not null check (horas >= 0),
    orden       integer not null default 0,
    created_at  timestamptz not null default now()
  );
  create index if not exists idx_plan_items_plan on public.plan_produccion_items (plan_id);
  create index if not exists idx_plan_items_empresa_fecha on public.plan_produccion_items (empresa_id, fecha);

  alter table public.planes_produccion enable row level security;
  drop policy if exists tenant_isolation_auth_planes_produccion on public.planes_produccion;
  create policy tenant_isolation_auth_planes_produccion on public.planes_produccion for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update, delete on public.planes_produccion to authenticated;
  grant usage, select on sequence public.planes_produccion_id_seq to authenticated;

  alter table public.plan_produccion_items enable row level security;
  drop policy if exists tenant_isolation_auth_plan_produccion_items on public.plan_produccion_items;
  create policy tenant_isolation_auth_plan_produccion_items on public.plan_produccion_items for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update, delete on public.plan_produccion_items to authenticated;
  grant usage, select on sequence public.plan_produccion_items_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('planes_produccion', 'plan_produccion_items');  -- t, t
