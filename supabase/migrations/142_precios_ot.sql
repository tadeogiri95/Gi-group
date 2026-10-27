-- 142: precio de cada OT (valorización de la planificación; app/lib/valorizacion.js)
--
-- CONTEXTO: la sincronización de OT lee la columna PRECIO (AE) del Plan de
-- trabajo, en pesos, y suma los renglones de cada OT. El precio va en una
-- tabla aparte (no en proyectos, que lee cualquiera) y solo lo leen Dueño y
-- Administración: la RLS deja leer solo a gerencial y administrativo, y
-- /api/data además se lo niega al supervisor de división. Lo escribe la
-- sincronización con service_role.
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- no se ven precios). Después de correrla, apretar Sincronizar en Proyectos.
-- Es idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.

do $mig$
begin
  create table if not exists public.precios_ot (
    empresa_id uuid not null references public.empresa(id) on delete cascade,
    ot         text not null,
    precio     numeric(16, 2) check (precio is null or precio >= 0),
    updated_at timestamptz not null default now(),
    primary key (empresa_id, ot)
  );

  alter table public.precios_ot enable row level security;
  drop policy if exists precios_ot_gestion on public.precios_ot;
  create policy precios_ot_gestion on public.precios_ot for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    );
  -- Solo lectura con el pase del usuario; escribe la sincronización (service_role)
  grant select on public.precios_ot to authenticated;
  grant select, insert, update on public.precios_ot to service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Después de Sincronizar, debería mostrar las OT con su precio:
--   select ot, precio from public.precios_ot order by ot desc limit 10;
