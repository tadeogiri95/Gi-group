-- 149: avisos de fin de proceso cada 15 minutos (Tadeo, 01/11;
-- app/lib/finProceso.js, app/lib/finProcesoServidor.js)
--
-- CONTEXTO: cuando llega la hora en que el plan dice que termina un proceso
-- de una OT (Corte, Canteado, Mecanizado o Armado) y todavía no está
-- terminado, Gypi avisa al celular de gerencia y del supervisor de la
-- división, para revisarlo o anotar "⏱ Faltan X h". Vercel (plan gratis)
-- solo corre tareas una vez por día, así que la llamada cada 15 minutos la
-- hace Supabase con pg_cron + pg_net.
--
-- PARTE 1 crea avisos_fin_proceso: qué se avisó, para no repetir. Sin esta
-- tabla Gypi no manda ningún aviso (mejor nada que uno cada 15 minutos).
--
-- PARTE 2 programa la llamada cada 15 minutos. ANTES de correrla, reemplazá
-- PEGAR_ACA_EL_CRON_SECRET por el valor de CRON_SECRET de Vercel
-- (Settings → Environment Variables). No guardes ese valor en el repositorio.
--
-- ORDEN: correr las dos partes antes o después de unir el PR (sin el PR la
-- llamada responde 404 y no pasa nada). Es idempotente. La parte 1 va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

-- ─── PARTE 1 ────────────────────────────────────────────────────────────────
do $mig$
begin
  create table if not exists public.avisos_fin_proceso (
    id          bigserial primary key,
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    clave       text not null check (char_length(clave) between 1 and 120), -- OT|proceso|día|minuto del fin
    fecha       date not null,
    ot          text not null check (char_length(ot) between 1 and 40),
    etapa       text not null check (etapa in ('corte', 'canteado', 'mecanizado', 'armado')),
    avisado_at  timestamptz not null default now(),
    unique (empresa_id, clave)
  );
  create index if not exists idx_avisos_fin_proceso_fecha on public.avisos_fin_proceso (empresa_id, fecha);
  -- Solo la escribe y la lee el cron (service_role)
  alter table public.avisos_fin_proceso enable row level security;

  insert into public.cron_ejecuciones (nombre, ultima_ok)
  values ('fin-proceso', now())
  on conflict (nombre) do nothing;
end
$mig$;

-- ─── PARTE 2 (reemplazar PEGAR_ACA_EL_CRON_SECRET antes de correr) ──────────
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'gypi-fin-proceso';
select cron.schedule(
  'gypi-fin-proceso',
  '*/15 * * * *',
  $cron$
    select net.http_get(
      url := 'https://gi-group-app.vercel.app/api/cron/fin-proceso',
      headers := jsonb_build_object('Authorization', 'Bearer PEGAR_ACA_EL_CRON_SECRET'),
      timeout_milliseconds := 60000
    );
  $cron$
);

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'avisos_fin_proceso';  -- t
--   select jobname, schedule from cron.job where jobname = 'gypi-fin-proceso';           -- */15 * * * *
--   select status_code, created from net._http_response order by created desc limit 5;  -- 200 cada 15 min
