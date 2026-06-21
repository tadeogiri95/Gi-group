-- 041: Agregar columna periodo a suscripciones para facturación anual.
-- Valores: 'mensual' (default) | 'anual'

ALTER TABLE suscripciones
  ADD COLUMN IF NOT EXISTS periodo text NOT NULL DEFAULT 'mensual'
  CHECK (periodo IN ('mensual', 'anual'));
