-- 179: Finanzas, estado de resultados (parte F6a)
--
-- CONTEXTO: el EERR del libro arma cada renglón con las cuentas que tienen
-- esa "clasificacion_eerr" en dim_plan_cuentas (ING_ENT, CMV_MOD_SUE,
-- GO_ADM_SUE…) y dice si cada cuenta es directa de una división o se
-- prorratea ("atribucion_div"). Gypi copia esas dos columnas del plan de
-- cuentas para armar 📊 Resultados.
--
-- Esta migración:
--   1. fin_cuentas.linea_eerr: el renglón del estado de resultados.
--   2. fin_cuentas.atribucion: DIRECTO / PRORRATEO (para la vista por
--      división, más adelante).
--   Las dos se llenan al copiar de nuevo el plan de cuentas desde el libro
--   (Finanzas → Configuración → 📥 Copiar desde el libro).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.fin_cuentas add column if not exists linea_eerr text;
  alter table public.fin_cuentas add column if not exists atribucion text;
  alter table public.fin_cuentas drop constraint if exists fin_cuentas_linea_eerr_largo;
  alter table public.fin_cuentas add constraint fin_cuentas_linea_eerr_largo check (linea_eerr is null or char_length(linea_eerr) <= 40);
  alter table public.fin_cuentas drop constraint if exists fin_cuentas_atribucion_largo;
  alter table public.fin_cuentas add constraint fin_cuentas_atribucion_largo check (atribucion is null or char_length(atribucion) <= 20);
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'fin_cuentas' and column_name in ('linea_eerr', 'atribucion');  -- 2 filas
