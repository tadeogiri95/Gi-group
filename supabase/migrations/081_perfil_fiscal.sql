-- 081_perfil_fiscal.sql — Factura C al CUIT del cliente (F6-02, F6-11, D15, ítem 26).
--
-- 1. Perfil fiscal de la empresa cliente, obligatorio para contratar un plan:
--    razón social, CUIT, condición frente al IVA y domicilio.
-- 2. pagos.receptor: copia de esos datos al momento de facturar, para que el
--    comprobante muestre siempre lo que se informó a ARCA aunque después
--    cambie el perfil.

alter table public.empresa
  add column if not exists razon_social     text,
  add column if not exists cuit             text,
  add column if not exists condicion_iva    text,
  add column if not exists domicilio_fiscal text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empresa_condicion_iva_check') then
    alter table public.empresa add constraint empresa_condicion_iva_check
      check (condicion_iva is null or condicion_iva in
        ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresa_cuit_formato_check') then
    alter table public.empresa add constraint empresa_cuit_formato_check
      check (cuit is null or cuit ~ '^[0-9]{11}$');
  end if;
end $$;

alter table public.pagos
  add column if not exists receptor jsonb;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_name = 'empresa' and column_name in ('razon_social','cuit','condicion_iva','domicilio_fiscal');  -- 4 filas
--   select column_name from information_schema.columns where table_name = 'pagos' and column_name = 'receptor'; -- 1 fila
