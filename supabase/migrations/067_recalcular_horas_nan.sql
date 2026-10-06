-- 067: Recalcular horas_trabajadas que quedaron en NaN (auditoría F1-01)
--
-- Hasta el arreglo de este PR, el egreso calculaba las horas con la hora de
-- ingreso en formato "08:00:00" y guardaba NaN. Esto recalcula esas filas a
-- partir de ingreso y egreso. Si el egreso es "menor" que el ingreso, es un
-- turno noche: el egreso fue al día siguiente.
--
-- OPCIONAL: los datos actuales son de prueba (decisión D4). Correrlo deja
-- bien los reportes de esas fichadas; no correrlo no rompe nada.

-- ─── PASO 1 (solo lectura): cuántas filas hay para arreglar ────────────────
--   select count(*) from public.fichadas
--   where ingreso is not null and egreso is not null
--     and (horas_trabajadas is null or horas_trabajadas = 'NaN'::numeric);

-- ─── PASO 2: recalcular ────────────────────────────────────────────────────
begin;

update public.fichadas
set horas_trabajadas = round(
  (extract(epoch from (
     (case when egreso < ingreso then fecha + 1 else fecha end) + egreso
     - (fecha + ingreso)
  )) / 3600)::numeric, 2)
where ingreso is not null
  and egreso is not null
  and (horas_trabajadas is null or horas_trabajadas = 'NaN'::numeric);

commit;

-- ─── VERIFICACIÓN (debe dar 0) ──────────────────────────────────────────────
--   select count(*) from public.fichadas
--   where ingreso is not null and egreso is not null
--     and (horas_trabajadas is null or horas_trabajadas = 'NaN'::numeric);
