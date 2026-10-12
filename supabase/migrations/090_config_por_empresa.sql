-- 090: config_sistema por empresa (enlace de la planilla de OT)
--
-- CONTEXTO: en producción la clave primaria de config_sistema es solo
-- `clave` (ver supabase/baseline/esquema-base.sql). Cada ajuste existía una
-- sola vez para TODO el sistema: si una empresa guardaba "proyectos_csv_url",
-- ninguna otra podía guardar el suyo (choque de clave primaria).
--
-- Esta migración pasa la clave primaria a (empresa_id, clave): cada empresa
-- tiene su propio ajuste. Las filas actuales ya son únicas por `clave`, así
-- que también lo son por (empresa_id, clave): no se pierde nada.
--
-- ORDEN: se puede correr en cualquier momento. Es idempotente.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.config_sistema'::regclass
      and conname = 'config_sistema_pkey'
      and array_length(conkey, 1) = 1
  ) then
    alter table public.config_sistema drop constraint config_sistema_pkey;
    alter table public.config_sistema add constraint config_sistema_pkey primary key (empresa_id, clave);
  end if;
end $$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Debería devolver: PRIMARY KEY (empresa_id, clave)
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.config_sistema'::regclass and contype = 'p';
