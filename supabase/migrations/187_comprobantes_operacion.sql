-- 187: Finanzas, varios comprobantes por movimiento (13/11, parte 4 del plan
-- de Tesorería)
--
-- CONTEXTO: hasta ahora cada operación tenía un solo comprobante
-- (fin_operaciones.comprobante_url, migración 176) y solo se cargaba desde Mi
-- caja. Tadeo pidió poder adjuntar uno o varios PDF o fotos a cualquier
-- movimiento, cobro o pago, al cargarlo y también después.
--
-- Esta migración:
--   1. fin_operaciones.comprobantes: la lista de comprobantes (hasta 10), cada
--      uno { url, nombre, tipo } ("pdf" o "foto").
--   2. Pasa el comprobante que ya estaba (comprobante_url) a la lista nueva.
--      comprobante_url queda como el primero, para lo que ya lo usa.
--
-- Los archivos van al mismo lugar que las fotos de Mi caja (bucket
-- reportes-obra, carpeta de la empresa). La RLS de fin_operaciones no cambia:
-- solo el rol gerencial.
--
-- ORDEN: correr ANTES de unir el PR que la usa (sin ella, Gypi sigue andando
-- pero no deja adjuntar). Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.fin_operaciones add column if not exists comprobantes jsonb not null default '[]'::jsonb;
  alter table public.fin_operaciones drop constraint if exists fin_operaciones_comprobantes_check;
  alter table public.fin_operaciones add constraint fin_operaciones_comprobantes_check
    check (jsonb_typeof(comprobantes) = 'array' and jsonb_array_length(comprobantes) <= 10);

  update public.fin_operaciones
     set comprobantes = jsonb_build_array(jsonb_build_object(
           'url', comprobante_url,
           'nombre', case when comprobante_url ilike '%.pdf' then 'Comprobante.pdf' else 'Foto del ticket' end,
           'tipo', case when comprobante_url ilike '%.pdf' then 'pdf' else 'foto' end))
   where comprobante_url is not null
     and comprobantes = '[]'::jsonb;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'fin_operaciones' and column_name = 'comprobantes';  -- 1 fila
--   select count(*) from fin_operaciones where comprobante_url is not null and comprobantes = '[]'::jsonb;  -- 0
