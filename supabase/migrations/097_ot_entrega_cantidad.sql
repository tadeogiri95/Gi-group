-- 097: fecha de entrega, cantidad y TERMINADO de la planilla en cada OT
-- (Órdenes de Producción, parte 1; ítem 39 de fase-7).
--
-- CONTEXTO: la sincronización con la planilla solo traía OT, cliente, obra,
-- división y descripción. El módulo de Órdenes de Producción necesita la
-- fecha de entrega (para el aviso de atraso) y la cantidad. TERMINADO se
-- guarda aparte del estado de la OT en la app: la planilla ya no abre ni
-- cierra OT.
--
-- Además deja 'activo' como valor por defecto del estado: la sincronización
-- ya no manda el estado (lo mandaba en cada pasada y reabría las OT cerradas),
-- así que las OT nuevas lo toman de acá.
--
-- ORDEN: se puede correr en cualquier momento, antes o después de aprobar el
-- PR. Es idempotente. Mientras no se corra, la sincronización sigue andando
-- sin estas columnas.

alter table public.proyectos add column if not exists fecha_entrega date;
alter table public.proyectos add column if not exists cantidad numeric;
alter table public.proyectos add column if not exists terminado_planilla boolean;

alter table public.proyectos alter column estado set default 'activo';

-- Por si alguna OT quedó sin estado
update public.proyectos set estado = 'activo' where estado is null;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver tres filas:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos'
--     and column_name in ('fecha_entrega', 'cantidad', 'terminado_planilla');
-- Debería decir 'activo'::text:
--   select column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'proyectos' and column_name = 'estado';
