-- 170: la fila completa de cada renglón de una lista de precios
-- (app/lib/listasPrecios.js detalleDeFila; se ve en Sin asociar)
--
-- CONTEXTO: Tadeo pidió (08/11) ver, además del código, la descripción o el
-- nombre completo del artículo de la lista subida, para asociarlo más fácil
-- al del MRP. Se guarda el resto de la fila del Excel ("Rubro: Herrajes ·
-- Unidad: u · …") en cada renglón.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 169). Es
-- idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL de
-- Supabase.

do $mig$
begin
  alter table public.facturas_sueltas_renglones
    add column if not exists detalle text;

  if not exists (select 1 from pg_constraint where conname = 'facturas_sueltas_renglones_detalle_check') then
    alter table public.facturas_sueltas_renglones
      add constraint facturas_sueltas_renglones_detalle_check check (detalle is null or char_length(detalle) <= 600);
  end if;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select descripcion, codigo, detalle from public.facturas_sueltas_renglones order by id desc limit 10;
