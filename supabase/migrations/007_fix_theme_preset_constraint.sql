-- Actualiza el CHECK constraint de theme_preset para incluir todos los presets actuales
-- Agrega: industrial, carbon, medianoche (y custom para modo personalizado)

ALTER TABLE empresa
  DROP CONSTRAINT IF EXISTS empresa_theme_preset_check;

ALTER TABLE empresa
  ADD CONSTRAINT empresa_theme_preset_check
  CHECK (theme_preset IN (
    'default',
    'crema',
    'hielo',
    'menta',
    'oscuro',
    'carbon',
    'medianoche',
    'industrial',
    'custom'
  ));
