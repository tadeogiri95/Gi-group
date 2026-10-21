-- 120: observación por renglón en la orden de compra (Compras, ítem 41)
--
-- CONTEXTO: al pedir material, los jefes de taller anotan cosas para el
-- proveedor (medida, color, marca…), pero esa nota no salía en la orden de
-- compra. Ahora cada renglón de la OC tiene su observación: se copia de la
-- nota del pedido al armar la OC, Administración la puede corregir o agregar
-- mientras la OC está en borrador, y sale en el PDF y en el WhatsApp/email.
--
-- Esta migración:
--   1. ordenes_compra_items.observacion (hasta 300 letras, como la nota del
--      pedido).
--   2. Completa la observación de los renglones que ya existen con la nota
--      de su pedido.
--
-- Sin la migración las OC se siguen armando, pero sin observación.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.ordenes_compra_items add column if not exists observacion text;
  alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_observacion_check;
  alter table public.ordenes_compra_items add constraint ordenes_compra_items_observacion_check
    check (observacion is null or char_length(observacion) <= 300);

  update public.ordenes_compra_items it
     set observacion = p.notas
    from public.pedidos_compra p
   where it.pedido_id = p.id
     and it.empresa_id = p.empresa_id
     and it.observacion is null
     and p.notas is not null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select count(*) filter (where observacion is not null) from public.ordenes_compra_items;
