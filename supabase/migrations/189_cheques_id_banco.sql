-- 189: Finanzas, listado de e-cheq del banco (13/11, parte 6 del plan de
-- Tesorería y Devengamiento)
--
-- CONTEXTO: el banco deja bajar el listado de e-cheq emitidos y recibidos
-- (Lista_de_ECHEQ.xls). Cada cheque trae un "Id. Cheque" único. Con el
-- listado, 🏦 Cheques se pone al día solo: qué se debitó, qué se depositó,
-- qué se endosó a un proveedor y qué volvió rechazado.
--
-- Esta migración:
--   1. fin_cheques.id_banco: el "Id. Cheque" del banco. Único por empresa:
--      subir el mismo listado otra vez no repite nada.
--   2. fin_cheques.origen acepta 'listado' (los cheques que se suman desde el
--      listado, sin operación, como los copiados del libro).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.fin_cheques add column if not exists id_banco text;
  begin
    alter table public.fin_cheques add constraint fin_cheques_id_banco_largo check (id_banco is null or char_length(id_banco) between 1 and 40);
  exception when duplicate_object then null;
  end;
  create unique index if not exists fin_cheques_id_banco on public.fin_cheques (empresa_id, id_banco) where id_banco is not null;

  alter table public.fin_cheques drop constraint if exists fin_cheques_origen_check;
  alter table public.fin_cheques add constraint fin_cheques_origen_check check (origen in ('manual', 'libro', 'pago', 'listado'));
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'fin_cheques' and column_name = 'id_banco';  -- 1 fila
