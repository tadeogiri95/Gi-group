-- 211: Foto de cada artículo del inventario (pedido de Tadeo, 26/11)
--
-- CONTEXTO: Tadeo quiere imprimir un rótulo por artículo con el nombre
-- normalizado, el SKU, el QR y una foto del artículo, para pegarlo donde se
-- guarda y descontarlo del stock al escanearlo cuando se consume (el QR abre
-- la ficha → "Retirar o devolver", parte 14).
--
-- Esta migración suma articulos_stock.foto_url: el link de la foto subida
-- desde la ficha del artículo (/api/upload). La sincronización con la planilla
-- MRP hace upsert solo de sus columnas, así que no la borra.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 106). Es
-- idempotente.

alter table public.articulos_stock
  add column if not exists foto_url text
  check (foto_url is null or char_length(foto_url) <= 500);

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'articulos_stock' and column_name = 'foto_url';  -- 1 fila
