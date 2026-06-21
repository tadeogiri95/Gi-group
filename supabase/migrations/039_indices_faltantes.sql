-- 039: Índices faltantes detectados en el diagnóstico integral.
--
-- registro_actividades(empresa_id, codigo_proyecto): queries del chat bot
-- (quien_trabajo_proyecto, ots_activas) filtran por codigo_proyecto.
--
-- notificaciones(empresa_id, leida): conteo de no leídas en inbox.

CREATE INDEX IF NOT EXISTS idx_actividad_empresa_proyecto
  ON registro_actividades (empresa_id, codigo_proyecto);

CREATE INDEX IF NOT EXISTS idx_notif_empresa_leida
  ON notificaciones (empresa_id, leida);
