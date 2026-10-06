-- 069: Permiso para retirarse antes del fin de la jornada (decisión D22)
--
-- Nueva regla de asistencia por empresa: permiso_salida_anticipada. Si está
-- activa, para fichar salida antes del fin de la grilla (menos la tolerancia)
-- el empleado necesita un permiso aprobado del día; lo pide desde el chat y,
-- una vez aprobado, ficha su salida él mismo.
--
-- No cambia el esquema (reglas_asistencia es jsonb, migración 068): solo la
-- activa para la fábrica piloto. Se puede cambiar desde Configuración → Reglas.
-- Requiere la 068. Se puede correr antes o después de aprobar el PR.

update public.empresa
set reglas_asistencia = reglas_asistencia || '{"permiso_salida_anticipada": true}'::jsonb
where slug = 'gypi';

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select slug, reglas_asistencia from public.empresa where slug = 'gypi';
--   (tiene que incluir "permiso_salida_anticipada": true)
