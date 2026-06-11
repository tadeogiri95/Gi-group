-- ═══════════════════════════════════════════════════════════════════════════
-- 018_password_reset_jti.sql — Token de reset de contraseña de un solo uso
--
-- Agrega password_reset_jti a empleados.
-- Al generar un link de reset: se guarda el JTI del token en esta columna.
-- Al consumir el link: se verifica que el JTI coincida y se setea a NULL.
-- Esto garantiza que cada link solo puede usarse una vez, aunque no haya expirado.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS password_reset_jti TEXT DEFAULT NULL;
