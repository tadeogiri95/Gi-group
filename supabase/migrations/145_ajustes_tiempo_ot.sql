-- 145: cambios de tiempo de los procesos de una OT, con su motivo (Tadeo,
-- 29/10; app/lib/ajustesTiempo.js)
--
-- CONTEXTO: el Gantt de OT es un "plan vivo" que se rearma cada día desde hoy.
-- Gerencia, supervisores y administración pueden:
--   - cargar "⏱ Faltan X h" en un proceso (tipo 'faltan'): manda sobre el
--     cálculo hasta que el proceso termine;
--   - anotar por qué se corrió un proceso que el plan vivo movió solo (tipo
--     'corrimiento', desde la lista "Atrasos sin motivo").
-- Siempre con un motivo: falta de material, falla de máquina, corte de
-- electricidad, tiempo de planificación subestimado, interrupción del trabajo
-- u otros (con un renglón que lo explica). Queda en la OT para analizar después.
--   horas      lo que falta (solo 'faltan'), en horas como las muestra el Gantt
--   pendiente  lo que faltaba del proceso (0 a 1) por escaneo o checkeo cuando se cargó
--   dias       cuántos días estaba corrido del plan confirmado
--
-- ORDEN: se puede correr antes o después de unir el PR (mientras no se corra,
-- guardar avisa que falta la migración). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.ajustes_tiempo_ot (
    id            bigserial primary key,
    empresa_id    uuid not null references public.empresa(id) on delete cascade,
    ot            text not null check (char_length(ot) between 1 and 40),
    etapa         text not null check (etapa in ('corte', 'canteado', 'mecanizado', 'armado')),
    tipo          text not null check (tipo in ('faltan', 'corrimiento')),
    horas         numeric(8, 2) check (horas is null or (horas >= 0 and horas <= 9999)),
    pendiente     numeric(5, 4) check (pendiente is null or (pendiente >= 0 and pendiente <= 1)),
    dias          integer not null default 0 check (dias >= 0),
    motivo        text not null check (motivo in ('falta_material', 'falla_maquina', 'corte_electricidad', 'planificacion_subestimada', 'interrupcion', 'otros')),
    detalle       text check (detalle is null or char_length(detalle) <= 300),
    creado_por    uuid references public.empleados(id) on delete set null,
    creado_nombre text check (creado_nombre is null or char_length(creado_nombre) <= 120),
    created_at    timestamptz not null default now(),
    check (tipo <> 'faltan' or horas is not null),
    check (motivo <> 'otros' or char_length(btrim(coalesce(detalle, ''))) > 0)
  );
  create index if not exists idx_ajustes_tiempo_ot_empresa_ot on public.ajustes_tiempo_ot (empresa_id, ot, created_at);

  alter table public.ajustes_tiempo_ot enable row level security;
  drop policy if exists tenant_isolation_auth_ajustes_tiempo_ot on public.ajustes_tiempo_ot;
  create policy tenant_isolation_auth_ajustes_tiempo_ot on public.ajustes_tiempo_ot for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert on public.ajustes_tiempo_ot to authenticated;
  grant usage, select on sequence public.ajustes_tiempo_ot_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'ajustes_tiempo_ot';  -- t
