-- ════════════════════════════════════════════════════════════════════
-- 051_solicitudes_resuelto_at.sql
-- InboxScreen.jsx (resolver aprobación/rechazo) escribe resuelto_at al
-- PATCHear una solicitud, pero ninguna migración creó esa columna —
-- mismo patrón de drift que 042/043. Sin esta columna (y sin el fix de
-- CAMPOS_PERMITIDOS en schemas.ts que la agrega al whitelist de PATCH),
-- la fecha de resolución nunca se guardó: el campo se descartaba en
-- silencio en /api/data antes de llegar a Postgres.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS resuelto_at timestamptz;
