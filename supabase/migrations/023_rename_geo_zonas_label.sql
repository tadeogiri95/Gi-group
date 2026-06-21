-- 023: Renombrar columna label → nombre en geo_zonas
-- para consistencia con el frontend que usa "nombre" en todos lados.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'geo_zonas' AND column_name = 'label'
  ) THEN
    ALTER TABLE geo_zonas RENAME COLUMN label TO nombre;
  END IF;
END $$;
