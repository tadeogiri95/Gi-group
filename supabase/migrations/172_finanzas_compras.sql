-- 172: Finanzas, compras automáticas (parte F2a; diseño en el doc "Finanzas
-- en Gypi: diseño de F1 y F2", 09/11)
--
-- CONTEXTO: cuando se carga la factura de una orden de compra o una factura
-- suelta, Gypi crea sola la compra en Finanzas (fin_operaciones, 171):
-- material o gasto por el neto, IVA crédito fiscal y otros impuestos contra
-- Proveedores por el total. Si se corrige la factura, la compra se corrige;
-- si se anula, la compra se anula.
--
-- Esta migración:
--   1. proveedores.fin_tipo: el tipo de compra de cada proveedor (COMPRA MP,
--      GASTOS DE LOGÍSTICA…). Gypi lo recuerda cuando el dueño lo cambia.
--   2. facturas_sueltas: proveedor_id (el de la lista de proveedores), iva y
--      otros_impuestos (hasta ahora solo tenía el neto).
--   3. fin_operaciones: una sola compra viva por factura (índice único).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.proveedores add column if not exists fin_tipo text;
  alter table public.proveedores drop constraint if exists proveedores_fin_tipo_check;
  alter table public.proveedores add constraint proveedores_fin_tipo_check
    check (fin_tipo is null or char_length(fin_tipo) between 1 and 80);

  alter table public.facturas_sueltas add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;
  alter table public.facturas_sueltas add column if not exists iva numeric(16, 2);
  alter table public.facturas_sueltas add column if not exists otros_impuestos numeric(16, 2);
  alter table public.facturas_sueltas drop constraint if exists facturas_sueltas_iva_check;
  alter table public.facturas_sueltas add constraint facturas_sueltas_iva_check
    check (iva is null or (iva >= 0 and iva < 100000000000000));
  alter table public.facturas_sueltas drop constraint if exists facturas_sueltas_otros_impuestos_check;
  alter table public.facturas_sueltas add constraint facturas_sueltas_otros_impuestos_check
    check (otros_impuestos is null or (otros_impuestos >= 0 and otros_impuestos < 100000000000000));

  create unique index if not exists fin_operaciones_origen_viva on public.fin_operaciones (empresa_id, origen, origen_id)
    where anulada_at is null and origen <> 'manual';
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'facturas_sueltas' and column_name in ('proveedor_id', 'iva', 'otros_impuestos');  -- 3 filas
--   select column_name from information_schema.columns where table_name = 'proveedores' and column_name = 'fin_tipo';  -- 1 fila
