-- 123: cerrar una orden de compra con faltantes (Compras, ítem 41)
--
-- CONTEXTO: a veces el proveedor no tiene todo. Se recibe lo que vino y el
-- resto no va a llegar, pero la OC quedaba para siempre "Recibida en parte"
-- (y la planilla lo seguía contando como EN TRÁNSITO). Ahora Administración
-- la cierra con faltantes: queda anotado quién, cuándo y por qué, y lo que
-- faltó de cada pedido de un jefe vuelve a "A comprar" como pedido
-- pendiente por la cantidad que no llegó.
--
-- Esta migración:
--   1. ordenes_compra.estado acepta 'cerrada_faltantes'.
--   2. ordenes_compra.cerrada_motivo, cerrada_por, cerrada_por_nombre, cerrada_at.
--   3. pedidos_compra.faltante_de: de qué OC viene un pedido que volvió por
--      faltante (ej. "OC N° 12 · Proveedor").
--
-- Sin la migración el botón "Cerrar con faltantes" avisa "migración 123".
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.ordenes_compra drop constraint if exists ordenes_compra_estado_check;
  alter table public.ordenes_compra add constraint ordenes_compra_estado_check
    check (estado in ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'cerrada_faltantes', 'anulada'));

  alter table public.ordenes_compra add column if not exists cerrada_motivo text;
  alter table public.ordenes_compra drop constraint if exists ordenes_compra_cerrada_motivo_check;
  alter table public.ordenes_compra add constraint ordenes_compra_cerrada_motivo_check
    check (cerrada_motivo is null or char_length(cerrada_motivo) <= 300);
  alter table public.ordenes_compra add column if not exists cerrada_por uuid references public.empleados(id) on delete set null;
  alter table public.ordenes_compra add column if not exists cerrada_por_nombre text;
  alter table public.ordenes_compra drop constraint if exists ordenes_compra_cerrada_por_nombre_check;
  alter table public.ordenes_compra add constraint ordenes_compra_cerrada_por_nombre_check
    check (cerrada_por_nombre is null or char_length(cerrada_por_nombre) <= 120);
  alter table public.ordenes_compra add column if not exists cerrada_at timestamptz;

  alter table public.pedidos_compra add column if not exists faltante_de text;
  alter table public.pedidos_compra drop constraint if exists pedidos_compra_faltante_de_check;
  alter table public.pedidos_compra add constraint pedidos_compra_faltante_de_check
    check (faltante_de is null or char_length(faltante_de) <= 160);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('cerrada_motivo', 'cerrada_por', 'cerrada_por_nombre', 'cerrada_at', 'faltante_de');
--   → 5 filas
