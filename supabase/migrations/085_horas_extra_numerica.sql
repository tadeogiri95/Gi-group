-- 085: fichadas.horas_extra pasa a número (horas, con decimales).
--
-- La 031 la creó como numeric con "ADD COLUMN IF NOT EXISTS", pero en
-- producción ya existía como boolean: la 031 no hizo nada y la columna quedó
-- boolean (ver supabase/baseline/esquema-base.sql). El servidor guarda ahí
-- las horas extra al fichar la salida (p. ej. 0.25) y Postgres lo rechaza:
-- quien llega puntual y se va más tarde no puede fichar la salida.
--
-- Los valores viejos: true pasa a las horas de horas_extras (la calculaba la
-- función vieja de fichar) o a 1 si no hay dato, que es lo que ya sumaba la
-- liquidación; false o vacío pasa a 0.
-- Se puede correr más de una vez: si ya es numérica, no hace nada.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fichadas' AND column_name = 'horas_extra') = 'boolean' THEN
    ALTER TABLE public.fichadas ALTER COLUMN horas_extra DROP DEFAULT;
    ALTER TABLE public.fichadas ALTER COLUMN horas_extra TYPE numeric
      USING (CASE WHEN horas_extra THEN COALESCE(horas_extras, 1) ELSE 0 END);
    ALTER TABLE public.fichadas ALTER COLUMN horas_extra SET DEFAULT 0;
  END IF;
END $$;

-- Verificación (solo lectura):
--   SELECT data_type, column_default FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'fichadas' AND column_name = 'horas_extra';
--   → numeric | 0
