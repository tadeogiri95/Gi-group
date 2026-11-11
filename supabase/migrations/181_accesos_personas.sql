-- 181: Accesos por persona (pedido de Tadeo del 11/11)
--
-- CONTEXTO: hasta ahora cualquier Dueño, Supervisor o Administración podía
-- cambiar las configuraciones de Gypi y prender o apagar módulos, y Finanzas
-- la veían todos los Dueños. Tadeo pidió que solo él (el titular de la
-- cuenta) o quien él designe cambie la configuración, y elegir qué módulos ve
-- cada persona de la oficina (por ejemplo, Finanzas solo para él).
--
-- Esta migración:
--   1. accesos_personas: una fila por persona de la oficina con
--        es_titular       → el titular de la cuenta (da los accesos),
--        puede_configurar → la deja cambiar las configuraciones,
--        modulos_ocultos  → los módulos que no ve (ni el servidor le da).
--      Sin fila, la persona ve todo menos Finanzas y no cambia configuración.
--   2. El titular: el Dueño que dio de alta la empresa (el email de la
--      empresa; si no aparece, el Dueño más antiguo).
--   3. RLS prendida y sin permisos para la app: la tabla solo la usa el
--      servidor con la service key (igual que empresa_modulos, 083).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.accesos_personas (
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    empleado_id       uuid not null references public.empleados(id) on delete cascade,
    es_titular        boolean not null default false,
    puede_configurar  boolean not null default false,
    modulos_ocultos   text[] not null default '{finanzas}' check (cardinality(modulos_ocultos) <= 40),
    actualizado_por   uuid references public.empleados(id) on delete set null,
    actualizado_en    timestamptz not null default now(),
    primary key (empresa_id, empleado_id)
  );
  create index if not exists accesos_personas_titular on public.accesos_personas (empresa_id) where es_titular;

  alter table public.accesos_personas enable row level security;
  revoke all on public.accesos_personas from anon, authenticated;

  -- Un titular por empresa: el Dueño con el email de la empresa o el más antiguo
  insert into public.accesos_personas (empresa_id, empleado_id, es_titular, puede_configurar, modulos_ocultos)
  select distinct on (e.id) e.id, em.id, true, true, '{}'
    from public.empresa e
    join public.empleados em on em.empresa_id = e.id and em.rol = 'gerencial' and coalesce(em.activo, true)
   where not exists (select 1 from public.accesos_personas a where a.empresa_id = e.id and a.es_titular)
   order by e.id,
            (lower(coalesce(em.email, '')) = lower(coalesce(e.admin_email, '-'))) desc,
            em.created_at asc nulls last
  on conflict (empresa_id, empleado_id) do update
    set es_titular = true, puede_configurar = true, modulos_ocultos = '{}', actualizado_en = now();
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Quién quedó como titular de cada empresa:
--   select e.nombre as empresa, em.nombre as titular, em.email
--     from public.accesos_personas a
--     join public.empresa e on e.id = a.empresa_id
--     join public.empleados em on em.id = a.empleado_id
--    where a.es_titular;
