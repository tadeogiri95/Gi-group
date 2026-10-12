-- 092: monitoreo del cron que trae las OT de la planilla todas las mañanas
--
-- /api/cron/sync-ot sincroniza las OT de cada empresa con planilla
-- configurada (6 de la mañana en Argentina). Igual que los demás crons (ver
-- 072), arranca como recién corrido para que el chequeo de salud no lo marque
-- atrasado antes de su primera corrida.
--
-- ORDEN: se puede correr en cualquier momento. Es idempotente. Sin esta
-- migración el cron igual sincroniza; solo falta su fila de monitoreo.

insert into public.cron_ejecuciones (nombre, ultima_ok)
values ('sync-ot', now())
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select nombre from public.cron_ejecuciones where nombre = 'sync-ot'; -- 1 fila
