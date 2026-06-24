-- 061: Facturación electrónica ARCA (ex AFIP) sobre pagos aprobados.
--
-- Cuando un pago de MercadoPago se aprueba, app/api/billing/webhook/route.js
-- intenta emitir una Factura C vía app/lib/afip.js (@afipsdk/afip.js). El
-- intento es fire-and-forget: nunca bloquea la activación del plan. Estas
-- columnas guardan el resultado (CAE real) o el motivo de falla, sobre la
-- misma fila de "pagos" que ya se inserta hoy.
--
-- Sin AFIP_ACCESS_TOKEN configurado, app/lib/afip.js es un kill-switch
-- (no hace nada) — estas columnas quedan NULL para todos los pagos hasta
-- que el usuario configure credenciales reales.

ALTER TABLE pagos
  ADD COLUMN IF NOT EXISTS cae               text,
  ADD COLUMN IF NOT EXISTS cae_vencimiento   date,
  ADD COLUMN IF NOT EXISTS numero_comprobante integer,
  ADD COLUMN IF NOT EXISTS punto_venta       integer,
  ADD COLUMN IF NOT EXISTS tipo_comprobante  integer,
  ADD COLUMN IF NOT EXISTS factura_error     text;
