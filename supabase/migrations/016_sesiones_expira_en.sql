-- ═══════════════════════════════════════════════════════════════════════════
-- 016_sesiones_expira_en.sql
-- La columna `expira_en` existe en el schema base (001) pero no fue creada
-- en producción (tabla creada antes o con schema distinto).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS expira_en timestamptz
  DEFAULT (now() + interval '30 days');

UPDATE sesiones
  SET expira_en = now() + interval '30 days'
  WHERE expira_en IS NULL;
