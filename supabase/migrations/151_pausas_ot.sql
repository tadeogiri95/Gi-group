-- 151: poner en pausa una OT (Tadeo, 02/11; app/lib/pausaOt.js)
--
-- CONTEXTO: cuando un proyecto queda en suspenso por una contingencia (el
-- cliente frena, falta de pago, la obra no está lista…) se para la
-- producción. Gerencia, supervisores o administración ponen la OT en pausa
-- con un motivo, y después la reanudan. Mientras está en pausa:
--   · el lead time no cuenta esas horas,
--   · la OT sale del plan vivo y del Gantt (las otras toman su lugar) y vuelve
--     desde el día en que se reanuda,
--   · no manda avisos de fin de proceso ni aparece en ⏰ OT atrasadas,
--   · el informe de producción no cuenta lo planificado esos días.
-- No se usa proyectos.estado porque la sincronización con la planilla lo pisa.
--
-- Esta migración crea pausas_ot: un renglón por pausa, con desde, hasta (vacío
-- mientras sigue en pausa), motivo y quién la puso y la sacó. Una OT puede
-- tener una sola pausa abierta a la vez.
--
-- ORDEN: correr ANTES de unir el PR (sin la tabla, la pausa no se puede
-- guardar; el resto anda igual). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.pausas_ot (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    ot               text not null check (char_length(ot) between 1 and 40),
    motivo           text not null check (motivo in ('cliente', 'falta_pago', 'obra_no_lista', 'falta_material', 'otros')),
    detalle          text check (detalle is null or char_length(detalle) <= 300),
    desde            timestamptz not null default now(),
    hasta            timestamptz,
    creado_por       uuid references public.empleados(id) on delete set null,
    creado_nombre    text check (creado_nombre is null or char_length(creado_nombre) <= 120),
    reanudada_nombre text check (reanudada_nombre is null or char_length(reanudada_nombre) <= 120),
    created_at       timestamptz not null default now(),
    check (motivo <> 'otros' or char_length(btrim(coalesce(detalle, ''))) > 0),
    check (hasta is null or hasta >= desde)
  );
  create index if not exists idx_pausas_ot_empresa_ot on public.pausas_ot (empresa_id, ot, desde);
  -- Una sola pausa abierta por OT
  create unique index if not exists uq_pausas_ot_abierta on public.pausas_ot (empresa_id, ot) where hasta is null;

  alter table public.pausas_ot enable row level security;
  drop policy if exists tenant_isolation_auth_pausas_ot on public.pausas_ot;
  create policy tenant_isolation_auth_pausas_ot on public.pausas_ot for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update on public.pausas_ot to authenticated;
  grant usage, select on sequence public.pausas_ot_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'pausas_ot';  -- t
