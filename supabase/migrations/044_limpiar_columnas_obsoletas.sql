-- ════════════════════════════════════════════════════════════════════
-- 044_limpiar_columnas_obsoletas.sql
-- Fase 1: renombrar columnas obsoletas (no DROP todavía).
-- Si nada rompe en 30 días, una migración futura las dropea.
-- ════════════════════════════════════════════════════════════════════

-- suscripciones.gateway_id — placeholder de 001, nunca usado por código.
-- Solo gateway_subscription_id (006) se usa.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suscripciones' AND column_name = 'gateway_id'
  ) THEN
    ALTER TABLE suscripciones RENAME COLUMN gateway_id TO _deprecated_gateway_id;
  END IF;
END $$;

-- empleados.ubicacion_fichaje — reemplazado por geo_config (028) + geo_zonas.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'empleados' AND column_name = 'ubicacion_fichaje'
  ) THEN
    ALTER TABLE empleados RENAME COLUMN ubicacion_fichaje TO _deprecated_ubicacion_fichaje;
  END IF;
END $$;
