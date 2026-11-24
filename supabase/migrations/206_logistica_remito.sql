-- 206: Logística, parte 4 — remito de cada parada (pedido de Tadeo, 23/11)
--
-- CONTEXTO: cada parada cumplida (entregada, parcial o rechazada) tiene su
-- remito interno de Gypi, sin precios: número correlativo por empresa, lo que
-- se entregó, fotos y la firma de quien recibió. Se abre con un link (sin
-- usuario de Gypi) para verlo, bajarlo en PDF y compartirlo por WhatsApp o
-- mail. Si cuando se entregó no había nadie para firmar, quien recibe firma
-- después desde ese mismo link. Se anota también el número del remito
-- oficial (ARCA) y el COT si los hay.
--
-- Esta migración (sin tablas nuevas; RLS y permisos quedan como en la 204):
--   1. logistica_paradas.remito_numero: correlativo por empresa (único).
--   2. remito_oficial y cot: los números de los papeles oficiales.
--   3. token: la llave del link del remito (largo y al azar; único).
--   4. firmada_link_at: cuándo firmó quien recibió desde el link.
--
-- ORDEN: correrla ANTES de unir el PR que la usa (necesita la 204 y la 205).
-- Es idempotente y va en un solo bloque (do $mig$ ... $mig$) por el editor
-- SQL de Supabase.
do $mig$
begin
  alter table public.logistica_paradas add column if not exists remito_numero integer;
  alter table public.logistica_paradas add column if not exists remito_oficial text;
  alter table public.logistica_paradas add column if not exists cot text;
  alter table public.logistica_paradas add column if not exists token text;
  alter table public.logistica_paradas add column if not exists firmada_link_at timestamptz;

  alter table public.logistica_paradas drop constraint if exists logistica_paradas_l4_check;
  alter table public.logistica_paradas add constraint logistica_paradas_l4_check check (
    (remito_numero is null or remito_numero > 0)
    and (remito_oficial is null or char_length(remito_oficial) <= 40)
    and (cot is null or char_length(cot) <= 40)
    and (token is null or char_length(token) between 20 and 80)
  );

  create unique index if not exists logistica_paradas_remito_unico on public.logistica_paradas (empresa_id, remito_numero) where remito_numero is not null;
  create unique index if not exists logistica_paradas_token_unico on public.logistica_paradas (token) where token is not null;
end
$mig$;

-- Que PostgREST vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'logistica_paradas' and column_name in ('remito_numero', 'remito_oficial', 'cot', 'token');  -- 4 filas
