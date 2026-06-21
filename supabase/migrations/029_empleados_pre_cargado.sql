ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS pre_cargado boolean DEFAULT false;
