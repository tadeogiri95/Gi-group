-- ════════════════════════════════════════════════════════════════════
-- seed.sql — Datos de desarrollo local
-- Ejecutar después de aplicar todas las migraciones.
-- Crea una empresa demo con empleados, fichadas y datos de prueba.
--
-- Contraseña de todos los empleados: Gypi2025!
-- ════════════════════════════════════════════════════════════════════

-- Empresa demo
INSERT INTO empresa (id, nombre, nombre_corto, slug, rubro, admin_email, admin_password, plan_activo, activa, email_verificado, timezone, max_empleados, onboarding_completado)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Constructora Demo SA',
  'Demo SA',
  'demo-sa',
  'construccion',
  'admin@demo-sa.test',
  '$2a$10$NxW9QmQfT7zGj6n3qF6K5uxZAYPhIyq3p6Y5NJD8hWw7V7d7VbpLa', -- Gypi2025!
  'starter',
  true,
  true,
  'America/Argentina/Buenos_Aires',
  50,
  true
) ON CONFLICT (slug) DO NOTHING;

-- Empleados
INSERT INTO empleados (id, empresa_id, legajo, nombre, apodo, email, password, rol, area, division, activo, debe_cambiar_password, diagrama)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1,
   'Carlos Gerente', 'Carlos', 'carlos@demo-sa.test',
   '$2a$10$NxW9QmQfT7zGj6n3qF6K5uxZAYPhIyq3p6Y5NJD8hWw7V7d7VbpLa',
   'gerencial', 'administracion', null, true, false,
   '{"lun":{"in":"08:00","out":"17:00"},"mar":{"in":"08:00","out":"17:00"},"mie":{"in":"08:00","out":"17:00"},"jue":{"in":"08:00","out":"17:00"},"vie":{"in":"08:00","out":"17:00"}}'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 2,
   'Ana Operaria', 'Ana', 'ana@demo-sa.test',
   '$2a$10$NxW9QmQfT7zGj6n3qF6K5uxZAYPhIyq3p6Y5NJD8hWw7V7d7VbpLa',
   'operativo', 'produccion', 'taller_a', true, false,
   '{"lun":{"in":"07:00","out":"16:00"},"mar":{"in":"07:00","out":"16:00"},"mie":{"in":"07:00","out":"16:00"},"jue":{"in":"07:00","out":"16:00"},"vie":{"in":"07:00","out":"16:00"}}'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 3,
   'Luis Técnico', 'Luis', 'luis@demo-sa.test',
   '$2a$10$NxW9QmQfT7zGj6n3qF6K5uxZAYPhIyq3p6Y5NJD8hWw7V7d7VbpLa',
   'operativo', 'produccion', 'campo', true, false,
   '{"lun":{"in":"06:00","out":"14:00"},"mar":{"in":"06:00","out":"14:00"},"mie":{"in":"06:00","out":"14:00"},"jue":{"in":"06:00","out":"14:00"},"vie":{"in":"06:00","out":"14:00"}}')
ON CONFLICT DO NOTHING;

-- Divisiones
INSERT INTO divisiones (empresa_id, clave, label, icon, color, orden, activa)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'taller_a', 'Taller A', 'Wrench', '#3b82f6', 1, true),
  ('a0000000-0000-0000-0000-000000000001', 'campo', 'Campo', 'MapPin', '#22c55e', 2, true)
ON CONFLICT DO NOTHING;

-- Etapas productivas
INSERT INTO etapas (empresa_id, codigo, nombre, icon, color, division, orden, activa)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 1, 'Producción', 'Hammer', '#22c55e', 'taller_a', 1, true),
  ('a0000000-0000-0000-0000-000000000001', 2, 'Espera material', 'Clock', '#f59e0b', 'taller_a', 2, true),
  ('a0000000-0000-0000-0000-000000000001', 3, 'Control calidad', 'CheckCircle', '#8b5cf6', 'taller_a', 3, true),
  ('a0000000-0000-0000-0000-000000000001', 0, 'Sin tarea', 'XCircle', '#6b7280', null, 0, true)
ON CONFLICT DO NOTHING;

-- Proyecto de ejemplo
INSERT INTO proyectos (empresa_id, codigo, nombre, estado, ot, cliente, obra)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'OT-001', 'Edificio Centro', 'activo', 'OT-001', 'Cliente Demo', 'Obra Centro')
ON CONFLICT DO NOTHING;

-- Geo zona de ejemplo
INSERT INTO geo_zonas (empresa_id, nombre, lat, lng, radio)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Oficina Central', -34.6037, -58.3816, 200)
ON CONFLICT DO NOTHING;

-- Fichadas de ejemplo (últimos 3 días laborales)
INSERT INTO fichadas (empresa_id, empleado_id, legajo, fecha, ingreso, egreso, horas_trabajadas, llegada_tarde, minutos_tarde)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 2, CURRENT_DATE - 2, '07:02', '16:05', 9.05, false, 0),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 2, CURRENT_DATE - 1, '07:15', '16:10', 8.92, true, 15),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 3, CURRENT_DATE - 2, '06:00', '14:00', 8.00, false, 0),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 3, CURRENT_DATE - 1, '06:05', '14:30', 8.42, false, 0)
ON CONFLICT DO NOTHING;

-- Config sistema
INSERT INTO config_sistema (empresa_id, clave, valor)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'auto_fichaje', '{"activo": true}'),
  ('a0000000-0000-0000-0000-000000000001', 'notificaciones', '{"push_habilitado": true}')
ON CONFLICT (empresa_id, clave) DO NOTHING;
