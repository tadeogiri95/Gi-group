-- 198: facturas y presupuestos adjuntos a la orden de pago (pedido de Tadeo
-- 19/11, punto 8 del plan "Corregir y ordenar Finanzas, Materiales y Gantt")
--
-- CONTEXTO: la orden de pago solo tenía una foto del comprobante del pago
-- (comprobante_url, 186). Ahora, mientras se arma la orden (o después), se le
-- pueden adjuntar uno o varios archivos, en PDF o foto: la factura o el
-- presupuesto que se paga. Se ven en la orden, en el link del CFO y en el
-- resumen de pagos.
--
-- fin_ordenes_pago.adjuntos = [{ url, nombre, tipo: "pdf"|"foto" }] (hasta 10;
-- los revisa app/lib/finanzasAdjuntos.js, como los comprobantes de 187).
--
-- ORDEN: correrla antes o después de unir el PR (sin la columna, la orden se
-- guarda igual, sin los adjuntos, y Gypi avisa). Es idempotente y va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.
do $mig$
begin
  alter table public.fin_ordenes_pago
    add column if not exists adjuntos jsonb not null default '[]'::jsonb;

  if not exists (select 1 from pg_constraint where conname = 'fin_ordenes_pago_adjuntos_lista') then
    alter table public.fin_ordenes_pago
      add constraint fin_ordenes_pago_adjuntos_lista
      check (jsonb_typeof(adjuntos) = 'array' and jsonb_array_length(adjuntos) <= 10);
  end if;
end
$mig$;

-- Que PostgREST vea la columna nueva sin esperar
notify pgrst, 'reload schema';
