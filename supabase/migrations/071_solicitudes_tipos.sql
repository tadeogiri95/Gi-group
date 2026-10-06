-- 071: Tipos de solicitud permitidos en la base (F1-06)
--
-- En producción existe la regla solicitudes_tipo_check (fuera de las
-- migraciones, drift F0-05) que solo acepta permiso, aviso, vacaciones,
-- ausencia y tardanza. Por eso fallaban, además del filtro de /api/data:
--   · hora_extra         ("Solicitar hora extra" del chat)
--   · salida_anticipada  (permiso para retirarse antes, D22)
--   · justificacion, cambio_horario, otro (aceptados por la app)
--
-- Se reemplaza la regla por una que acepta la unión de ambas listas
-- (se conserva 'aviso' por si hay filas viejas con ese tipo).
-- Correr ANTES de aprobar el PR #17. Es idempotente.

alter table public.solicitudes drop constraint if exists solicitudes_tipo_check;

alter table public.solicitudes add constraint solicitudes_tipo_check check (
  tipo = any (array[
    'permiso', 'aviso', 'vacaciones', 'ausencia', 'tardanza',
    'justificacion', 'cambio_horario', 'hora_extra', 'salida_anticipada', 'otro'
  ]::text[])
);

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.solicitudes'::regclass and conname = 'solicitudes_tipo_check';
--   (tiene que incluir hora_extra y salida_anticipada)
--
-- ─── REVERTIR ───────────────────────────────────────────────────────────────
--   alter table public.solicitudes drop constraint solicitudes_tipo_check;
--   alter table public.solicitudes add constraint solicitudes_tipo_check check (
--     tipo = any (array['permiso','aviso','vacaciones','ausencia','tardanza']::text[]));
--   (falla si ya hay solicitudes con los tipos nuevos)
