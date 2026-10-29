-- 146: informe de producción (Tadeo, 29/10; app/lib/informeProduccion.js)
--
-- CONTEXTO: cada noche sale el informe de producción del día (email a
-- administración y aviso al celular de gerencia) y se guarda; en Reportes →
-- 🏭 Producción se ven los guardados y se pide uno parcial del día, la semana
-- o el mes. Para saber cuánto se avanzó en un período en los procesos sin
-- escaneo, el checkeo manual de OT (141) ahora guarda su historial.
--
-- Esta migración crea:
--   1. informes_produccion: un informe por empresa, tipo y período, con su
--      nota (1 a 10, de a 0,5) y todo el contenido (datos).
--   2. avance_manual_historial: cada % que se carga en el checkeo manual,
--      con la fecha y quién lo cargó.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- el informe se puede pedir igual pero no se guarda, y el checkeo manual no
-- cuenta en lo hecho del período). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.informes_produccion (
    id          bigserial primary key,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    tipo        text not null check (tipo in ('dia', 'semana', 'mes')),
    desde       date not null,
    hasta       date not null,
    nota        numeric(3, 1) check (nota is null or (nota >= 1 and nota <= 10)),
    datos       jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    check (hasta >= desde),
    unique (empresa_id, tipo, desde)
  );
  create index if not exists idx_informes_produccion_empresa on public.informes_produccion (empresa_id, desde desc);

  create table if not exists public.avance_manual_historial (
    id          bigserial primary key,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    ot          text not null check (char_length(ot) between 1 and 40),
    etapa       integer not null check (etapa > 0),
    pct         integer not null check (pct between 0 and 100),
    creado_por  uuid references public.empleados(id) on delete set null,
    created_at  timestamptz not null default now()
  );
  create index if not exists idx_avance_manual_historial_empresa on public.avance_manual_historial (empresa_id, ot, created_at);

  alter table public.informes_produccion enable row level security;
  drop policy if exists tenant_isolation_auth_informes_produccion on public.informes_produccion;
  create policy tenant_isolation_auth_informes_produccion on public.informes_produccion for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select on public.informes_produccion to authenticated;

  alter table public.avance_manual_historial enable row level security;
  drop policy if exists tenant_isolation_auth_avance_manual_historial on public.avance_manual_historial;
  create policy tenant_isolation_auth_avance_manual_historial on public.avance_manual_historial for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert on public.avance_manual_historial to authenticated;
  grant usage, select on sequence public.avance_manual_historial_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('informes_produccion', 'avance_manual_historial');  -- t, t
