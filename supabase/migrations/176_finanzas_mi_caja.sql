-- 176: Finanzas, Mi caja (parte F3b)
--
-- CONTEXTO: cada responsable de una caja (fin_tesoreria.responsable_id, 171)
-- carga desde el celular lo que gastó y la plata que recibió. Entra a su caja
-- en el momento como "para revisar" y el dueño lo confirma en Finanzas →
-- Cajas y bancos. Al gasto se le puede sacar una foto del ticket.
--
-- Esta migración:
--   1. fin_operaciones.comprobante_url: el link de la foto del ticket.
--
-- La carga va por el servidor (/api/mi-caja), que revisa que la caja sea del
-- que carga: el responsable no necesita ver Finanzas y la RLS de
-- fin_operaciones sigue siendo solo del rol gerencial.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.fin_operaciones add column if not exists comprobante_url text;
  alter table public.fin_operaciones drop constraint if exists fin_operaciones_comprobante_url_check;
  alter table public.fin_operaciones add constraint fin_operaciones_comprobante_url_check
    check (comprobante_url is null or (char_length(comprobante_url) <= 500 and comprobante_url like 'https://%'));
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'fin_operaciones' and column_name = 'comprobante_url';  -- 1 fila
