-- 025: Agregar columnas faltantes en empresa
-- theme_preset y typography son usadas por admin_empresa_screen y theme.js
-- pero nunca fueron creadas en una migration.

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS theme_preset text DEFAULT 'default';
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS typography text DEFAULT 'system';
