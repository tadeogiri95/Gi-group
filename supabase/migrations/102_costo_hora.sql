-- 102: costo de la hora de mano de obra (Órdenes de Producción, parte 8; ítem 39)
--
-- CONTEXTO: el dueño carga cuánto le cuesta una hora de trabajo (un solo
-- valor para toda la fábrica) y la app calcula el costo de mano de obra de
-- cada OT con las horas que ya se registran, separado en fábrica, paradas e
-- instalación.
--
-- Esta migración:
--   1. costos_empresa: una fila por empresa con el costo de la hora.
--   2. RLS: además de la regla por empresa, solo el rol gerencial (el dueño)
--      la puede leer o cambiar. Ni el supervisor ni el administrativo la ven.
--      La app la usa solo por /api/costo-hora.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente y va en una
-- sola transacción.

begin;

create table if not exists public.costos_empresa (
  empresa_id      uuid primary key references public.empresa(id) on delete cascade,
  costo_hora      numeric(12, 2) not null check (costo_hora >= 0 and costo_hora <= 99999999),
  actualizado_por uuid references public.empleados(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.costos_empresa enable row level security;
drop policy if exists tenant_isolation_auth_costos_empresa on public.costos_empresa;
create policy tenant_isolation_auth_costos_empresa on public.costos_empresa for all to authenticated
  using (
    empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
    and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial'
  )
  with check (
    empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
    and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial'
  );
grant select, insert, update on public.costos_empresa to authenticated;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'costos_empresa';  -- t
