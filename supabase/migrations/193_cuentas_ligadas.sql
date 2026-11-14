-- 193: La cuenta contable de cada operación ligada al plan de cuentas (14/11,
-- pedido de Tadeo: "que todo quede relacionado y sea el mismo dato en todo el
-- sistema").
--
-- CONTEXTO: fin_operaciones guarda la cuenta del debe y del haber como código
-- ("01.01.01.003.002"). Hasta ahora lo controlaba solo Gypi al cargar: la base
-- dejaba guardar un código que no estaba en el plan, y eso aparecía después
-- como "no cuadra: hay operaciones con una cuenta que no está en el plan".
--
-- Esta migración:
--   1. Liga cuenta_debe y cuenta_haber con fin_cuentas (clave foránea por
--      empresa + código). Desde ahora la base no deja guardar una operación
--      con una cuenta que no está en el plan, ni borrar del plan una cuenta
--      que tiene operaciones (se puede desactivar).
--   2. Si ya hay operaciones viejas con una cuenta fuera del plan, la liga
--      igual vale para todo lo nuevo, y esas quedan listadas para
--      arreglarlas (paso 3). Cuando no queda ninguna, se valida todo.
--   3. fin_cuentas_sin_plan(empresa): las cuentas usadas que no están en el
--      plan, con cuántas operaciones tienen. Gypi la usa para avisar.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_operaciones_cuenta_debe_plan') then
    alter table public.fin_operaciones add constraint fin_operaciones_cuenta_debe_plan
      foreign key (empresa_id, cuenta_debe) references public.fin_cuentas (empresa_id, codigo) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_operaciones_cuenta_haber_plan') then
    alter table public.fin_operaciones add constraint fin_operaciones_cuenta_haber_plan
      foreign key (empresa_id, cuenta_haber) references public.fin_cuentas (empresa_id, codigo) not valid;
  end if;
  create index if not exists fin_operaciones_cuenta_debe on public.fin_operaciones (empresa_id, cuenta_debe);
  create index if not exists fin_operaciones_cuenta_haber on public.fin_operaciones (empresa_id, cuenta_haber);

  -- Lo viejo: si todo está en el plan, queda validado; si no, sigue valiendo para lo nuevo
  begin
    alter table public.fin_operaciones validate constraint fin_operaciones_cuenta_debe_plan;
    alter table public.fin_operaciones validate constraint fin_operaciones_cuenta_haber_plan;
  exception when foreign_key_violation then
    raise notice 'Hay operaciones viejas con una cuenta que no está en el plan: ver fin_cuentas_sin_plan';
  end;

  create or replace function public.fin_cuentas_sin_plan(p_empresa uuid)
  returns table (cuenta text, operaciones bigint)
  language sql stable security invoker set search_path = public as $fn$
    select x.cuenta, count(*)::bigint
      from (
        select o.cuenta_debe as cuenta from public.fin_operaciones o where o.empresa_id = p_empresa and o.anulada_at is null
        union all
        select o.cuenta_haber from public.fin_operaciones o where o.empresa_id = p_empresa and o.anulada_at is null
      ) x
     where not exists (select 1 from public.fin_cuentas c where c.empresa_id = p_empresa and c.codigo = x.cuenta)
     group by x.cuenta
     order by x.cuenta
  $fn$;
  grant execute on function public.fin_cuentas_sin_plan(uuid) to authenticated, service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select conname, convalidated from pg_constraint where conname like 'fin_operaciones_cuenta_%_plan';  -- 2 filas
--   select * from public.fin_cuentas_sin_plan('<id de la empresa>');  -- ojalá ninguna
