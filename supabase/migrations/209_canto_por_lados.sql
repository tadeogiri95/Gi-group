-- 209: Canto por lados en el escaneo de piezas (pedido de Tadeo, 25/11)
--
-- CONTEXTO: en la planilla técnica los grupos L1 A, L1 B, L2 A y L2 B son
-- los lados del panel; un lado lleva canto si sus columnas E y COLOR son
-- distintas de 0. En la etapa de canto (la que en Configuración → Etapas
-- tiene las columnas L1A, L1B, L2A, L2B) una pieza con 3 lados de canto se
-- escanea 3 veces: recién con el tercero queda pegada. 4 piezas iguales de
-- 3 lados = 12 escaneos.
--
-- Esta migración:
--   1. piezas_ot.lados: cuántos lados con canto tiene la pieza (lo lee Gypi
--      de la planilla; null = la planilla no trae los lados, cuenta 1).
--   2. lados_pieza: un escaneo por lado (quién y cuándo). La fila de
--      pasos_pieza se anota recién con el último lado, así el avance, el
--      Panel y el Trello siguen contando piezas completas. Si la pieza se
--      borra, se borran sus lados.
--   3. RLS: misma regla por empresa que pasos_pieza (110); la app la
--      escribe solo por /api/piezas/paso.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 110 y la 112).
-- Es idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor
-- SQL de Supabase.
do $mig$
begin
  alter table public.piezas_ot add column if not exists lados smallint;
  alter table public.piezas_ot drop constraint if exists piezas_ot_lados_check;
  alter table public.piezas_ot add constraint piezas_ot_lados_check
    check (lados is null or lados between 0 and 4);

  create table if not exists public.lados_pieza (
    id           bigserial primary key,
    empresa_id   uuid not null references public.empresa(id) on delete cascade,
    ot           text not null,
    pieza_id     bigint not null references public.piezas_ot(id) on delete cascade,
    etapa        integer not null,
    empleado_id  uuid references public.empleados(id) on delete set null,
    created_at   timestamptz not null default now()
  );
  create index if not exists lados_pieza_pieza_etapa on public.lados_pieza (pieza_id, etapa);
  create index if not exists lados_pieza_empresa_ot on public.lados_pieza (empresa_id, ot, etapa);

  alter table public.lados_pieza enable row level security;
  drop policy if exists tenant_isolation_auth_lados_pieza on public.lados_pieza;
  create policy tenant_isolation_auth_lados_pieza on public.lados_pieza for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  revoke all on public.lados_pieza from anon;
  grant select, insert, update, delete on public.lados_pieza to authenticated;
  grant usage, select on sequence public.lados_pieza_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'lados_pieza';  -- t
--   select count(*) from public.piezas_ot where lados is not null;      -- sube cuando Gypi relee las planillas
