-- ═══════════════════════════════════════════════════════════════════════════
-- 005_indices.sql — Índices recomendados para las consultas frecuentes
--
-- ⚠️ NO EJECUTAR sin revisar. Documentación de los índices que la app
-- asume para que las consultas más usadas sean rápidas. Los `-- VERIFICAR`
-- marcan índices que probablemente ya existan pero no se confirmaron
-- contra Supabase Studio.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── empresa ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresa_slug         ON empresa (slug);
CREATE INDEX        IF NOT EXISTS idx_empresa_admin_email  ON empresa (admin_email);


-- ─── empleados ───
-- Login: WHERE legajo = ? AND activo = true (+ a veces empresa_id)
CREATE INDEX IF NOT EXISTS idx_empleados_legajo_activo
  ON empleados (empresa_id, legajo) WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_empleados_empresa
  ON empleados (empresa_id);


-- ─── sesiones ───
-- validar_sesion() hace lookup por token y filtra por expira_en > now()
CREATE UNIQUE INDEX IF NOT EXISTS idx_sesiones_token       ON sesiones (token);
CREATE INDEX        IF NOT EXISTS idx_sesiones_expira      ON sesiones (expira_en);
CREATE INDEX        IF NOT EXISTS idx_sesiones_empleado    ON sesiones (empleado_id);


-- ─── fichadas ───
-- Consultas frecuentes:
--   * fichadas?empleado_id=X&fecha=Y&empresa_id=Z
--   * fichadas?legajo=X&empresa_id=Y&fecha=gte.M-01&llegada_tarde=eq.true (contar tardes)
--   * fichadas?fecha=gte.lunes (semana)
CREATE INDEX IF NOT EXISTS idx_fichadas_empleado_fecha
  ON fichadas (empleado_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_fichadas_empresa_fecha
  ON fichadas (empresa_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_fichadas_legajo_tarde
  ON fichadas (empresa_id, legajo, fecha) WHERE llegada_tarde = true;


-- ─── solicitudes ───
CREATE INDEX IF NOT EXISTS idx_solicitudes_empresa_estado
  ON solicitudes (empresa_id, estado);

CREATE INDEX IF NOT EXISTS idx_solicitudes_empleado
  ON solicitudes (empleado_id);


-- ─── notificaciones ───
CREATE INDEX IF NOT EXISTS idx_notif_empresa_destinatario
  ON notificaciones (empresa_id, destinatario_rol, created_at DESC);


-- ─── registro_actividades ───
-- Tarea activa: WHERE empleado_id = X AND hora_fin IS NULL
CREATE INDEX IF NOT EXISTS idx_actividad_activa
  ON registro_actividades (empleado_id) WHERE hora_fin IS NULL;

CREATE INDEX IF NOT EXISTS idx_actividad_empleado_fecha
  ON registro_actividades (empleado_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_actividad_empresa_fecha
  ON registro_actividades (empresa_id, fecha DESC);


-- ─── reportes_obra ───
CREATE INDEX IF NOT EXISTS idx_reportes_empresa_fecha
  ON reportes_obra (empresa_id, fecha DESC);


-- ─── proyectos ───
CREATE INDEX IF NOT EXISTS idx_proyectos_empresa_estado
  ON proyectos (empresa_id, estado);


-- ─── etapas ───
CREATE INDEX IF NOT EXISTS idx_etapas_empresa
  ON etapas (empresa_id, division, orden) WHERE activa = true;


-- ─── push_tokens ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_unique
  ON push_tokens (legajo, token);

CREATE INDEX IF NOT EXISTS idx_push_tokens_legajo
  ON push_tokens (empresa_id, legajo);


-- ─── geo_zonas ───
CREATE INDEX IF NOT EXISTS idx_geo_zonas_empresa
  ON geo_zonas (empresa_id);


-- ─── geo_registros ───
CREATE INDEX IF NOT EXISTS idx_geo_registros_empleado
  ON geo_registros (empleado_id, created_at DESC);


-- ─── notas_calendario ───
CREATE INDEX IF NOT EXISTS idx_notas_empresa_fecha
  ON notas_calendario (empresa_id, fecha);


-- ─── mensajes_chat ───
CREATE INDEX IF NOT EXISTS idx_chat_empleado
  ON mensajes_chat (empleado_id, created_at DESC);


-- ─── suscripciones ───
CREATE INDEX IF NOT EXISTS idx_suscripciones_empresa_estado
  ON suscripciones (empresa_id, estado, created_at DESC);


-- ─── pagos ───
CREATE INDEX IF NOT EXISTS idx_pagos_empresa
  ON pagos (empresa_id, created_at DESC);


-- ─── invitaciones_empresa ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitaciones_codigo
  ON invitaciones_empresa (codigo);
