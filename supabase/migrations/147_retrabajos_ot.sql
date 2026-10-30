-- 147: retrabajo de un proceso de una OT (Tadeo, 30/10; app/lib/retrabajo.js)
--
-- CONTEXTO: cuando hay que volver a un proceso (por ejemplo, piezas mal
-- cortadas después de terminar Corte), gerencia, supervisores o
-- administración cargan las horas de retrabajo con su motivo. El % del
-- proceso no baja: el Gantt suma esas horas como una extensión roja de la
-- barra del proceso hasta que se marca "✓ Retrabajo terminado", y el informe
-- de producción las muestra.
--
-- Esta migración crea retrabajos_ot: un renglón por retrabajo, con las horas,
-- el motivo, quién lo cargó y cuándo se terminó.
--
-- ORDEN: correr ANTES de unir el PR (sin la tabla, el retrabajo no se puede
-- guardar; el resto anda igual). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.retrabajos_ot (
    id              bigserial primary key,
    empresa_id      uuid not null references public.empresa(id) on delete cascade,
    ot              text not null check (char_length(ot) between 1 and 40),
    etapa           text not null check (etapa in ('corte', 'canteado', 'mecanizado', 'armado')),
    horas           numeric(8, 2) not null check (horas > 0 and horas <= 9999),
    motivo          text not null check (motivo in ('pieza_mal_cortada', 'error_medida', 'danio_manipulacion', 'falla_maquina',
                      'canto_mal_pegado', 'pieza_mal_procesada', 'error_diseno', 'otros')),
    detalle         text check (detalle is null or char_length(detalle) <= 300),
    creado_por      uuid references public.empleados(id) on delete set null,
    creado_nombre   text check (creado_nombre is null or char_length(creado_nombre) <= 120),
    created_at      timestamptz not null default now(),
    terminado_at    timestamptz,
    terminado_nombre text check (terminado_nombre is null or char_length(terminado_nombre) <= 120),
    check (motivo <> 'otros' or char_length(btrim(coalesce(detalle, ''))) > 0)
  );
  create index if not exists idx_retrabajos_ot_empresa_ot on public.retrabajos_ot (empresa_id, ot, created_at);

  alter table public.retrabajos_ot enable row level security;
  drop policy if exists tenant_isolation_auth_retrabajos_ot on public.retrabajos_ot;
  create policy tenant_isolation_auth_retrabajos_ot on public.retrabajos_ot for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update on public.retrabajos_ot to authenticated;
  grant usage, select on sequence public.retrabajos_ot_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'retrabajos_ot';  -- t
