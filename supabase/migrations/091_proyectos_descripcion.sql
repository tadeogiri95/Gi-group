-- 091: descripción de cada OT (columna DESCRIPCION de la planilla)
--
-- CONTEXTO: el empleado, al elegir la OT de su tarea, necesita ver cliente,
-- obra y descripción, como en la planilla. La sincronización ya traía cliente
-- y obra; la descripción no tenía dónde guardarse.
--
-- ORDEN: se puede correr en cualquier momento. Es idempotente. Mientras no
-- se corra, la sincronización sigue andando sin la descripción.

alter table public.proyectos add column if not exists descripcion text;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos' and column_name = 'descripcion';
