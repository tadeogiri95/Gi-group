-- 178: Finanzas, sueldos (parte F5b)
--
-- CONTEXTO: los sueldos se calculan afuera y Tadeo pasa la liquidación a
-- Gypi: por período, un renglón por empleado y un importe (o una cantidad de
-- horas) por concepto. Al confirmarla, cada importe es un DEVENG SUELDO en su
-- cuenta contra Sueldos A Pagar (fin_operaciones, origen "liquidacion"); al
-- pagar, un PAGO SUELDO desde la caja o el banco (origen "pago_sueldo").
--
-- Esta migración:
--   1. fin_liquidaciones: período (texto, p. ej. "Octubre 2026"), fecha del
--      devengado, estado (borrador / confirmada / anulada) y los renglones
--      (jsonb: [{ empleado_id, nombre, valores: { concepto: número } }]).
--   2. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: una liquidación se anula.
--   Los conceptos y la cuenta de sueldo de cada empleado van en
--   config_sistema ("finanzas_sueldos"), sin tabla.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_liquidaciones (
    id              bigserial primary key,
    empresa_id      uuid not null references public.empresa(id) on delete cascade,
    periodo         text not null check (char_length(periodo) between 1 and 60),
    fecha           date not null,
    estado          text not null default 'borrador' check (estado in ('borrador', 'confirmada', 'anulada')),
    renglones       jsonb not null default '[]'::jsonb check (jsonb_typeof(renglones) = 'array' and jsonb_array_length(renglones) <= 1000),
    notas           text check (notas is null or char_length(notas) <= 500),
    cargada_por_nombre text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    confirmada_at   timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
  );
  create index if not exists fin_liquidaciones_empresa on public.fin_liquidaciones (empresa_id, fecha desc);

  alter table public.fin_liquidaciones enable row level security;
  drop policy if exists tenant_isolation_auth_fin_liquidaciones on public.fin_liquidaciones;
  create policy tenant_isolation_auth_fin_liquidaciones on public.fin_liquidaciones for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_liquidaciones to authenticated;
  grant usage, select on sequence public.fin_liquidaciones_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_liquidaciones';  -- t
