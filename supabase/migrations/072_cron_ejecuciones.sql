-- 072: Registro de ejecuciones de los crons (F3-12)
--
-- Cada cron guarda acá cuándo corrió y si salió bien (app/lib/cronMonitor.js).
-- /api/health lo usa para avisar si algún cron dejó de correr; el monitor
-- externo de uptime (UptimeRobot) manda el aviso por email.
--
-- Solo la usa el servidor (service role): RLS activado y sin policies, así
-- anon/authenticated no la leen ni la escriben.
-- Se puede correr antes o después de aprobar el PR. Es idempotente.

create table if not exists public.cron_ejecuciones (
  nombre         text primary key,
  ultima_corrida timestamptz,
  ultima_ok      timestamptz,
  ultimo_error   text,
  duracion_ms    integer
);

alter table public.cron_ejecuciones enable row level security;
revoke all on public.cron_ejecuciones from anon, authenticated;

-- Punto de partida: se considera que todos corrieron bien ahora. Si alguno no
-- vuelve a correr dentro de su ventana, /api/health lo va a marcar atrasado.
insert into public.cron_ejecuciones (nombre, ultima_ok)
select n, now() from unnest(array[
  'auto-fichaje', 'limpiar-tokens', 'trial-reminder', 'vencer-trials',
  'push-ausencias', 'inactividad-produccion', 'health-check', 'refresh-scores',
  'reengagement-onboarding', 'reconciliacion-mp'
]) as n
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select nombre, ultima_corrida, ultima_ok, ultimo_error from public.cron_ejecuciones order by nombre;
--   (10 filas; después de cada corrida, ultima_corrida se actualiza)
--
-- ─── REVERTIR ───────────────────────────────────────────────────────────────
--   drop table public.cron_ejecuciones;
