-- 031: Agregar columna horas_extra en fichadas
-- Almacena las horas extra calculadas al fichar egreso.
-- Se calcula comparando egreso real vs egreso de grilla (diagrama).

ALTER TABLE fichadas ADD COLUMN IF NOT EXISTS horas_extra numeric DEFAULT 0;
