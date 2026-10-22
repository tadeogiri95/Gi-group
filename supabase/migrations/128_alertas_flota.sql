-- 128: alertas de mantenimiento de la flota (Mantenimiento, parte 30; ítem 43;
-- diseño en notes/diseno-mantenimiento-vehicular.md)
--
-- CONTEXTO: cada vehículo tiene, por aspecto (limpieza, fluidos, neumáticos,
-- luces, ITV, documentación y service), cada cuánto se revisa: en días o en
-- kilómetros, lo que pase primero. Un checklist que revisa una sección la pone
-- al día. Una vez por día /api/cron/flota-alertas revisa toda la flota y
-- avisa al celular del responsable y de gerencia y Administración cuando algo
-- vence o está por vencer. Solo avisa: no bloquea nada.
--
-- Esta migración:
--   1. vehiculos.frecuencias: lo que cambia la empresa para ese vehículo
--      ({ "fluidos": { "dias": 10, "km": 1500 } }); lo que no está usa las
--      frecuencias de fábrica.
--   2. vehiculos.service_fecha y service_km: el último service (cambio de
--      aceite y filtros). La parte 31 los completa sola al cargar un service.
--   3. vehiculos.aviso_firma y aviso_at: qué se avisó la última vez, para no
--      repetir el mismo aviso todos los días.
--   4. cron_ejecuciones: siembra 'flota-alertas' para que /api/health no lo
--      dé por atrasado antes de su primera corrida.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 126 y la 127).
-- Es idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.

do $mig$
begin
  alter table public.vehiculos add column if not exists frecuencias jsonb not null default '{}'::jsonb;
  alter table public.vehiculos drop constraint if exists vehiculos_frecuencias_objeto;
  alter table public.vehiculos add constraint vehiculos_frecuencias_objeto check (jsonb_typeof(frecuencias) = 'object');
  alter table public.vehiculos add column if not exists service_fecha date;
  alter table public.vehiculos add column if not exists service_km integer check (service_km is null or (service_km >= 0 and service_km <= 9999999));
  alter table public.vehiculos add column if not exists aviso_firma text check (aviso_firma is null or char_length(aviso_firma) <= 2000);
  alter table public.vehiculos add column if not exists aviso_at timestamptz;

  insert into public.cron_ejecuciones (nombre, ultima_ok)
  values ('flota-alertas', now())
  on conflict (nombre) do nothing;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'vehiculos' and column_name in ('frecuencias', 'service_fecha', 'service_km', 'aviso_firma');  -- 4 filas
--   select nombre from public.cron_ejecuciones where nombre = 'flota-alertas';  -- 1 fila
