-- 201: marcar qué OT llevan IVA (pedido de Tadeo 22/11)
--
-- CONTEXTO: el PRECIO de las OT (columna del Plan de trabajo, 142) es sin
-- IVA. Algunas OT se facturan con IVA: el Dueño, el Supervisor o
-- Administración tildan "Lleva IVA (21 %)" en el detalle de la OT o en la
-- cuenta corriente del cliente. Con la casilla tildada:
--   - la cuenta corriente por OT y el estado de cuenta en PDF muestran esa
--     OT con IVA (precio × 1,21);
--   - la venta automática de Finanzas deja al cliente debiendo el total con
--     IVA: el neto a Ventas Generales y el 21 % a IVA Debito Fiscal.
-- Margen, valorización, minuta y estado de resultados siguen sin IVA.
-- La sincronización del Plan no toca esta columna.
--
-- ORDEN: correrla antes de unir el PR (sin la columna, la casilla avisa que
-- falta la migración y todo sigue sin IVA). Es idempotente y va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.proyectos
    add column if not exists lleva_iva boolean not null default false;
end
$mig$;

-- Que PostgREST vea la columna nueva sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select ot, lleva_iva from public.proyectos where lleva_iva order by ot desc limit 10;
