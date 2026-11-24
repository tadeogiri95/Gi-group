-- 208: Logística, parte 6 — tablero del dueño y ubicación (pedido de Tadeo, 23/11)
--
-- CONTEXTO: el dueño ve en un tablero los viajes del día por chofer y
-- vehículo, las firmas pendientes, si las entregas se hicieron el día
-- planeado y las incidencias (parciales, rechazos y paradas no visitadas).
-- Gypi guarda dónde estaba el celular del chofer al salir y al terminar el
-- viaje (en cada parada ya se guardaba, 205), y mientras el chofer tiene
-- Gypi abierto con el viaje en camino manda su ubicación cada 2 minutos: el
-- dueño ve la última y hace cuánto. Una app web no puede mandarla con el
-- teléfono bloqueado; para eso, el chofer comparte su ubicación en tiempo
-- real desde Google Maps.
--
-- Esta migración (sin tablas nuevas; RLS y permisos quedan como en la 204):
--   logistica_viajes: salida_lat/lng, llegada_lat/lng y la última ubicación
--   (ubic_lat, ubic_lng, ubic_at).
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 204 y la 205).
-- Es idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor
-- SQL de Supabase.
do $mig$
begin
  alter table public.logistica_viajes add column if not exists salida_lat  numeric(9, 6);
  alter table public.logistica_viajes add column if not exists salida_lng  numeric(9, 6);
  alter table public.logistica_viajes add column if not exists llegada_lat numeric(9, 6);
  alter table public.logistica_viajes add column if not exists llegada_lng numeric(9, 6);
  alter table public.logistica_viajes add column if not exists ubic_lat    numeric(9, 6);
  alter table public.logistica_viajes add column if not exists ubic_lng    numeric(9, 6);
  alter table public.logistica_viajes add column if not exists ubic_at     timestamptz;

  alter table public.logistica_viajes drop constraint if exists logistica_viajes_l6_check;
  alter table public.logistica_viajes add constraint logistica_viajes_l6_check check (
    (salida_lat is null or salida_lat between -90 and 90) and (salida_lng is null or salida_lng between -180 and 180)
    and (llegada_lat is null or llegada_lat between -90 and 90) and (llegada_lng is null or llegada_lng between -180 and 180)
    and (ubic_lat is null or ubic_lat between -90 and 90) and (ubic_lng is null or ubic_lng between -180 and 180)
  );
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'logistica_viajes' and column_name in ('salida_lat', 'llegada_lat', 'ubic_lat', 'ubic_at');  -- 4 filas
