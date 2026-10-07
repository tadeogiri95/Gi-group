-- 077_resumen_semanal.sql — Resumen semanal por email para el dueño (D10, ítem 31).
-- Activado por defecto; cada empresa lo puede apagar desde Gestión → Empresa.
ALTER TABLE public.empresa
  ADD COLUMN IF NOT EXISTS resumen_semanal boolean NOT NULL DEFAULT true;

-- Monitoreo del cron nuevo (ver 072): arranca como recién corrido.
insert into public.cron_ejecuciones (nombre, ultima_ok)
values ('resumen-semanal', now())
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name = 'empresa' and column_name = 'resumen_semanal';
--   select nombre from public.cron_ejecuciones where nombre = 'resumen-semanal';
