-- 122: factura de la orden de compra con IVA y otros impuestos (Compras, ítem 41)
--
-- CONTEXTO: en Compras → Órdenes la factura solo tenía el precio final sin IVA
-- de cada renglón. Ahora se carga como viene en el papel: por renglón la
-- cantidad facturada, el precio unitario sin IVA y el IVA % (21, 10,5, 27 o
-- 0); neto, IVA y total los calcula Gypi. Los otros impuestos (percepciones,
-- impuestos internos) van una sola vez para toda la factura. Al stock sigue
-- entrando el precio sin IVA.
--
-- Esta migración:
--   1. ordenes_compra_items.cantidad_facturada (vacía = lo que llegó).
--   2. ordenes_compra_items.iva_alicuota (vacía = 21).
--   3. ordenes_compra.factura_otros_impuestos.
--
-- Sin la migración la factura no se puede guardar (avisa "migración 122").
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.ordenes_compra_items add column if not exists cantidad_facturada numeric(14, 3);
  alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_cantidad_facturada_check;
  alter table public.ordenes_compra_items add constraint ordenes_compra_items_cantidad_facturada_check
    check (cantidad_facturada is null or (cantidad_facturada >= 0 and cantidad_facturada < 10000000000));

  alter table public.ordenes_compra_items add column if not exists iva_alicuota numeric(5, 2);
  alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_iva_alicuota_check;
  alter table public.ordenes_compra_items add constraint ordenes_compra_items_iva_alicuota_check
    check (iva_alicuota is null or iva_alicuota in (0, 10.5, 21, 27));

  alter table public.ordenes_compra add column if not exists factura_otros_impuestos numeric(16, 2);
  alter table public.ordenes_compra drop constraint if exists ordenes_compra_factura_otros_impuestos_check;
  alter table public.ordenes_compra add constraint ordenes_compra_factura_otros_impuestos_check
    check (factura_otros_impuestos is null or factura_otros_impuestos >= 0);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('cantidad_facturada', 'iva_alicuota', 'factura_otros_impuestos');
--   → 3 filas
