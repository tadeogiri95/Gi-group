-- 167: costo final de cada OT al cerrarse, con constancia (costo de OT,
-- parte C; diseño en notes/diseno-costo-ot.md; app/lib/costoFinal.js)
--
-- CONTEXTO: Tadeo pidió (08/11) que cuando se cierre la OT quede calculado
--   Costo final = costo de materiales + costo de la hora × horas-persona
-- y que quede constancia de todo lo usado para la cuenta. La OT no se traba:
-- si se reabre, la constancia queda anulada en el historial y al volver a
-- cerrarse se calcula una nueva.
--
-- Una OT se cierra de varias maneras (a mano en Gypi o con TERMINADO = SI
-- en la planilla), así que el momento del cierre lo anota la base sola:
--   - al pasar proyectos.estado a 'cerrado' se agrega un costo 'pendiente'
--     con la hora del cierre; la app lo calcula enseguida (al abrir la OT o
--     en el cron de cada mañana) y guarda la constancia;
--   - al reabrirse, el costo pendiente o calculado pasa a 'anulado'.
-- Las OT que ya estaban cerradas antes de esta migración no se calculan solas:
-- en su detalle hay un botón para calcularlo.
--
-- Esta migración:
--   1. costos_finales_ot: una fila por cierre, con los totales y en
--      `detalle` la foto completa (renglones de material con precio, fecha y
--      origen; horas-persona por proceso; costo de la hora usado).
--   2. Disparador en proyectos que anota los cierres y las reaperturas.
--   3. RLS: solo el Dueño con su pase; la app usa /api/costo-final (Dueño y
--      Supervisor) con la clave del servidor.
--   4. cron_ejecuciones: siembra 'costos-ot' (calcula cada mañana los cierres
--      pendientes, después de la sincronización) para que /api/health no lo
--      dé por atrasado antes de su primera corrida.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.costos_finales_ot (
    id                    bigserial primary key,
    empresa_id            uuid not null references public.empresa(id) on delete cascade,
    ot                    text not null check (char_length(ot) between 1 and 40),
    cerrada_at            timestamptz not null default now(),
    estado                text not null default 'pendiente' check (estado in ('pendiente', 'calculado', 'anulado')),
    motivo                text not null default 'cierre' check (motivo in ('cierre', 'manual', 'recalculo')),
    calculado_at          timestamptz,
    calculado_por_nombre  text check (calculado_por_nombre is null or char_length(calculado_por_nombre) <= 120),
    materiales            numeric(16, 2),
    sin_precio            integer,
    horas_persona         numeric(10, 1),
    costo_hora            numeric(12, 2),
    mano_obra             numeric(16, 2),
    total                 numeric(16, 2),
    detalle               jsonb,
    anulado_at            timestamptz,
    anulado_motivo        text check (anulado_motivo is null or char_length(anulado_motivo) <= 200),
    created_at            timestamptz not null default now()
  );
  create index if not exists costos_finales_ot_empresa_ot on public.costos_finales_ot (empresa_id, ot, created_at desc);
  create index if not exists costos_finales_ot_pendientes on public.costos_finales_ot (estado) where estado = 'pendiente';

  alter table public.costos_finales_ot enable row level security;
  drop policy if exists costos_finales_ot_dueno on public.costos_finales_ot;
  create policy costos_finales_ot_dueno on public.costos_finales_ot for select to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial'
    );
  grant select on public.costos_finales_ot to authenticated;
  grant select, insert, update on public.costos_finales_ot to service_role;
  grant usage, select on sequence public.costos_finales_ot_id_seq to service_role;

  execute $f$
    create or replace function public.anotar_cierre_ot() returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      if new.estado = 'cerrado' and old.estado is distinct from 'cerrado' then
        insert into costos_finales_ot (empresa_id, ot, cerrada_at, estado, motivo)
        values (new.empresa_id, left(new.ot, 40), now(), 'pendiente', 'cierre');
      elsif old.estado = 'cerrado' and new.estado is distinct from 'cerrado' then
        update costos_finales_ot
           set estado = 'anulado', anulado_at = now(), anulado_motivo = 'Se reabrió la OT'
         where empresa_id = new.empresa_id and ot = new.ot and estado in ('pendiente', 'calculado');
      end if;
      return new;
    end
    $body$
  $f$;

  drop trigger if exists proyectos_anotar_cierre on public.proyectos;
  create trigger proyectos_anotar_cierre
    after update of estado on public.proyectos
    for each row
    when (new.ot is not null)
    execute function public.anotar_cierre_ot();

  insert into public.cron_ejecuciones (nombre, ultima_ok)
  values ('costos-ot', now())
  on conflict (nombre) do nothing;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Después de cerrar una OT:
--   select ot, estado, cerrada_at, materiales, mano_obra, total from public.costos_finales_ot order by created_at desc limit 10;
