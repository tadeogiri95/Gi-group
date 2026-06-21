-- Migración 021: proyectos — columnas extendidas para CSV sync
-- Ejecutar en Supabase Studio → SQL Editor
-- SEGURA: ADD COLUMN IF NOT EXISTS no rompe nada si las columnas ya existen.

ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS ot       text,
  ADD COLUMN IF NOT EXISTS cliente  text,
  ADD COLUMN IF NOT EXISTS obra     text,
  ADD COLUMN IF NOT EXISTS proyecto text,
  ADD COLUMN IF NOT EXISTS division text;

-- Unique constraint (empresa_id, ot) para que el upsert funcione
-- Si ya existe con el mismo nombre falla silenciosamente.
DO $$
BEGIN
  ALTER TABLE proyectos ADD CONSTRAINT uq_proyectos UNIQUE (empresa_id, ot);
EXCEPTION WHEN duplicate_object THEN
  -- Constraint ya existe, no hacer nada
  NULL;
END $$;
