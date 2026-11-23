-- 202: placas, fondos y metros de canto de cada OT sacados del MRP (pedido de
-- Tadeo, 23/11)
--
-- CONTEXTO: los tiempos de una OT (Planificación, Gantt, informe) se calculan
-- con las placas, los fondos y los cantos del Nuevo Plan de Trabajo (136).
-- Cuando el Plan no los trae, ahora se completan con las necesidades del MRP
-- (necesidades_stock, 108): placas = familia "Placas, chapas, mallas y
-- paneles" de Madera (hasta 6 mm son fondos) y canto = "CANTO" en el nombre.
-- Lo cargado en el Plan siempre manda. La sincronización de la planilla MRP
-- guarda acá los totales de cada OT; la del Plan no toca estas columnas.
--
-- ORDEN: correrla antes de unir el PR (sin las columnas todo sigue solo con
-- el Plan). Después apretar Sincronizar en Planta → Stock. Es idempotente y
-- va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.proyectos
    add column if not exists placas_mrp numeric(14, 3),
    add column if not exists fondos_mrp numeric(14, 3),
    add column if not exists metros_canto_mrp numeric(14, 3);
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select ot, placas, placas_mrp, fondos, fondos_mrp, metros_canto, metros_canto_mrp
--   from public.proyectos where placas_mrp is not null order by ot desc limit 20;
