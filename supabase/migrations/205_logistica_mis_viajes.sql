-- 205: Logística, parte 3 — Mis viajes del chofer (pedido de Tadeo, 23/11)
--
-- CONTEXTO: el chofer ve en su Inicio los viajes que tiene asignados, aprieta
-- "Salir" y va cumpliendo cada parada: tilda lo que entregó (los bultos y
-- sueltos de la OT, o renglones a mano), saca de 1 a 5 fotos, le hace firmar
-- con el dedo a quien recibe y marca la parada como entregada, parcial,
-- rechazada o no visitada (con el motivo). Al final termina el viaje.
--
-- Esta migración:
--   1. logistica_viajes: cuándo salió y cuándo terminó.
--   2. logistica_paradas: lo que se entregó o retiró (renglones), las fotos,
--      la firma con el nombre y DNI de quien firmó (o "sin firma"), el motivo
--      de lo parcial o rechazado, quién y cuándo la cumplió y dónde estaba el
--      celular en ese momento (si dio permiso de ubicación).
--   No hay tablas nuevas: RLS y permisos quedan como en la 204. La app
--   escribe solo por /api/logistica.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 204). Es
-- idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.
do $mig$
begin
  alter table public.logistica_viajes add column if not exists salida_at  timestamptz;
  alter table public.logistica_viajes add column if not exists llegada_at timestamptz;

  alter table public.logistica_paradas add column if not exists renglones jsonb not null default '[]'::jsonb;
  alter table public.logistica_paradas add column if not exists fotos text[] not null default '{}';
  alter table public.logistica_paradas add column if not exists firma_url text;
  alter table public.logistica_paradas add column if not exists firma_nombre text;
  alter table public.logistica_paradas add column if not exists firma_dni text;
  alter table public.logistica_paradas add column if not exists sin_firma boolean not null default false;
  alter table public.logistica_paradas add column if not exists motivo text;
  alter table public.logistica_paradas add column if not exists hecha_por uuid references public.empleados(id) on delete set null;
  alter table public.logistica_paradas add column if not exists hecha_at timestamptz;
  alter table public.logistica_paradas add column if not exists hecha_lat numeric(9, 6);
  alter table public.logistica_paradas add column if not exists hecha_lng numeric(9, 6);

  alter table public.logistica_paradas drop constraint if exists logistica_paradas_l3_check;
  alter table public.logistica_paradas add constraint logistica_paradas_l3_check check (
    jsonb_typeof(renglones) = 'array' and jsonb_array_length(renglones) <= 200
    and cardinality(fotos) <= 5
    and (firma_url is null or char_length(firma_url) <= 500)
    and (firma_nombre is null or char_length(firma_nombre) <= 120)
    and (firma_dni is null or char_length(firma_dni) <= 20)
    and (motivo is null or char_length(motivo) <= 300)
    and (hecha_lat is null or hecha_lat between -90 and 90)
    and (hecha_lng is null or hecha_lng between -180 and 180)
  );

  create index if not exists logistica_viajes_mios on public.logistica_viajes (chofer_id, estado, fecha);
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'logistica_paradas' and column_name in ('renglones', 'fotos', 'firma_url', 'hecha_at');  -- 4 filas
