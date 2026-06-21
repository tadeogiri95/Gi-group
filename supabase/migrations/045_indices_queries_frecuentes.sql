-- ════════════════════════════════════════════════════════════════════
-- 045_indices_queries_frecuentes.sql
-- Índices faltantes para queries frecuentes encontrados en la auditoría.
-- ════════════════════════════════════════════════════════════════════

-- 1. empleados.email — login por email (login-empresa/route.js línea 140)
--    Query: empleados?email=eq.X&activo=eq.true&empresa_id=eq.Y
CREATE INDEX IF NOT EXISTS idx_empleados_email_empresa
  ON empleados (empresa_id, lower(email))
  WHERE activo = true AND email IS NOT NULL;

-- 2. fichadas — egreso turno nocturno (fichar/route.js línea 248)
--    Query: fichadas?empleado_id=eq.X&empresa_id=eq.Y&egreso=is.null&order=fecha.desc
CREATE INDEX IF NOT EXISTS idx_fichadas_egreso_pendiente
  ON fichadas (empleado_id, fecha DESC)
  WHERE egreso IS NULL;

-- 3. registro_actividades — tarea activa (fichar/route.js línea 203)
--    Ya cubierto por idx_actividad_activa, pero sin empresa_id.
--    El query filtra por empleado_id + empresa_id + hora_fin IS NULL.
CREATE INDEX IF NOT EXISTS idx_actividad_activa_empresa
  ON registro_actividades (empleado_id, empresa_id)
  WHERE hora_fin IS NULL;

-- 4. notificaciones — conteo no leídas es query muy frecuente
--    Ya existe idx_notif_empresa_leida pero es (empresa_id, leida) sin order.
--    Mejoramos para cubrir el query con order=created_at.desc.
CREATE INDEX IF NOT EXISTS idx_notif_no_leidas
  ON notificaciones (empresa_id, created_at DESC)
  WHERE leida = false;

-- 5. suscripciones — billing/webhook busca por gateway_subscription_id
CREATE INDEX IF NOT EXISTS idx_suscripciones_gateway_sub_id
  ON suscripciones (gateway_subscription_id)
  WHERE gateway_subscription_id IS NOT NULL;

-- 6. sesiones — refresh-token busca por refresh_jti (ya tiene índice parcial)
--    pero validarToken busca por jti. Verificar que idx_sesiones_jti cubre.
--    → Ya existe idx_sesiones_jti WHERE jti IS NOT NULL. OK.

-- 7. pagos — webhook idempotency check por gateway_payment_id
--    Ya existe UNIQUE constraint pagos_gateway_payment_id_unique. OK.
