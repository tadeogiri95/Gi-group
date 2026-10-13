-- 098: ruta de etapas de cada división (Órdenes de Producción, parte 2;
-- ítem 39 de fase-7).
--
-- CONTEXTO: hoy el operario ve todas las etapas de la empresa, aunque no
-- sean de su división. La ruta dice qué etapas usa cada división y en qué
-- orden (por ejemplo Muebles: Corte → Enchapado → Armado → Pintura).
-- Se guarda como la lista ordenada de códigos de etapa. Vacía o null = sin
-- ruta: esa división sigue viendo todas las etapas, como hoy.
--
-- ORDEN: se puede correr en cualquier momento, antes o después de aprobar el
-- PR. Es idempotente. Mientras no se corra, todo sigue como hoy y la pantalla
-- de rutas avisa que falta esta migración al guardar.
--
-- Permisos: divisiones ya tiene RLS por empresa y SELECT para authenticated
-- (089/093); la columna nueva queda cubierta. Solo se edita desde
-- /api/config-empresa (servidor).

alter table public.divisiones add column if not exists ruta_etapas integer[];

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver una fila:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'divisiones' and column_name = 'ruta_etapas';
