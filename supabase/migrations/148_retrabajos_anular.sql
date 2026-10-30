-- 148: eliminar un retrabajo mal cargado (Tadeo, 30/10; app/lib/retrabajo.js)
--
-- CONTEXTO: un retrabajo mal imputado se elimina desde el Gantt. No se borra
-- el renglón: queda anulado con cuándo y quién, y no cuenta en el Gantt ni en
-- el informe de producción.
--
-- ORDEN: correr ANTES de unir el PR (necesita la 147). Sin esta migración el
-- resto anda igual, pero no se puede eliminar. Es idempotente. Va en un solo
-- bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.retrabajos_ot add column if not exists anulado_at timestamptz;
  alter table public.retrabajos_ot add column if not exists anulado_nombre text;
  alter table public.retrabajos_ot drop constraint if exists retrabajos_ot_anulado_nombre_check;
  alter table public.retrabajos_ot add constraint retrabajos_ot_anulado_nombre_check
    check (anulado_nombre is null or char_length(anulado_nombre) <= 120);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'retrabajos_ot' and column_name like 'anulado%';  -- 2
