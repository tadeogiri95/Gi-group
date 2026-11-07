-- 163: destino de los módulos, las piezas sin módulo y los herrajes de cada
-- OT (Tadeo, 07/11; app/lib/destinosPiezas.js)
--
-- CONTEXTO: las piezas de cada OT llegan solas desde la planilla de despiece
-- (PR #304). El código de cada pieza es (OT)-(Módulo)-(Pieza): las piezas con
-- el mismo módulo forman ese módulo, que se arma y viaja como un bulto. Para
-- tener todo definido al armar y al cargar:
--   - cada módulo se puede marcar "Van sueltas" (por ejemplo AJ, ajustes);
--     si no, se arma;
--   - cada pieza sin módulo, (OT)-(Pieza), se asigna a un módulo (va armada
--     dentro de él) o va suelta; mientras no se elige queda sin definir;
--   - los herrajes y perfiles de NECESIDADES van dentro del mueble salvo que
--     la planilla (columna SUELTO) o alguien en Gypi diga que van sueltos.
-- Lo suelto pasa a 📦 Sueltos de la OT para tildarlo en el acopio y la carga.
--
-- Esta migración:
--   1. destinos_ot: una fila por módulo, pieza o herraje que tenga algo que
--      recordar. Lo que dice la planilla (planilla_suelto, datos del herraje)
--      lo escribe la lectura de la planilla; lo que se elige a mano (suelto,
--      modulo) no se pisa al volver a leerla.
--   2. sueltos_ot.origen: 'planilla' en los sueltos que pone Gypi solo, así
--      al cambiar un destino se corrigen esos y nunca los cargados a mano.
--      Marca los que ya había puesto la planilla (ids guardados en la config
--      planillas_piezas_script).
--   3. RLS: misma regla por empresa que el resto; la app escribe destinos_ot
--      solo por /api/piezas y /api/piezas/planillas.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.destinos_ot (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    ot               text not null,
    tipo             text not null check (tipo in ('modulo', 'pieza', 'herraje')),
    clave            text not null check (char_length(clave) between 1 and 300),
    datos            jsonb,
    planilla_suelto  boolean not null default false,
    en_planilla      boolean not null default false,
    suelto           boolean,
    modulo           text check (modulo is null or char_length(modulo) <= 40),
    actualizado_por  uuid references public.empleados(id) on delete set null,
    updated_at       timestamptz not null default now(),
    constraint destinos_ot_unico unique (empresa_id, ot, tipo, clave)
  );

  alter table public.destinos_ot enable row level security;
  drop policy if exists tenant_isolation_auth_destinos_ot on public.destinos_ot;
  create policy tenant_isolation_auth_destinos_ot on public.destinos_ot for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update, delete on public.destinos_ot to authenticated;
  grant usage, select on sequence public.destinos_ot_id_seq to authenticated;

  alter table public.sueltos_ot add column if not exists origen text;
  alter table public.sueltos_ot drop constraint if exists chk_sueltos_ot_origen;
  alter table public.sueltos_ot add constraint chk_sueltos_ot_origen check (origen is null or origen = 'planilla');

  -- Los sueltos que ya había puesto la carga automática (PR #305)
  update public.sueltos_ot s set origen = 'planilla'
  from (
    select c.empresa_id, x.id::bigint as id
    from public.config_sistema c,
         jsonb_each(coalesce(c.valor->'cargas', '{}'::jsonb)) as carga(ot, v),
         jsonb_array_elements_text(coalesce(carga.v->'sueltos'->'ids', carga.v->'sueltos_previos', '[]'::jsonb)) as x(id)
    where c.clave = 'planillas_piezas_script'
      and jsonb_typeof(c.valor->'cargas') = 'object'
  ) p
  where s.empresa_id = p.empresa_id and s.id = p.id and s.origen is null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'destinos_ot';   -- t
--   select count(*) from public.sueltos_ot where origen = 'planilla';
