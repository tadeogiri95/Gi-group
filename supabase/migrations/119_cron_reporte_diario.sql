-- 119: monitoreo del cron del reporte del día (seguimiento de OT por escaneo,
-- parte 26).
--
-- /api/cron/reporte-diario manda todos los días a las 23 h (Argentina) el
-- reporte de producción e instalación al dueño de cada empresa. Igual que los
-- demás crons (ver 072), arranca como recién corrido para que el chequeo de
-- salud no lo marque atrasado antes de su primera corrida.
--
-- ORDEN: se puede correr en cualquier momento. Es idempotente. Sin esta
-- migración el cron igual manda el reporte; solo falta su fila de monitoreo.

insert into public.cron_ejecuciones (nombre, ultima_ok)
values ('reporte-diario', now())
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select nombre from public.cron_ejecuciones where nombre = 'reporte-diario'; -- 1 fila
