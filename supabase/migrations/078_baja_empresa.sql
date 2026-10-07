-- 078_baja_empresa.sql — Baja de cuenta self-service con 30 días de retención
-- y borrado definitivo (F6-01, ítem 28).
--
-- 1. empresa.baja_solicitada_en: cuándo el dueño dio de baja la cuenta (la
--    empresa queda con activa=false). Si la reactiva, vuelve a null.
-- 2. purgar_empresa(uuid): borra TODAS las filas de la empresa en todas las
--    tablas con empresa_id y después la empresa. Solo si la baja tiene más de
--    30 días; la llama el cron purgar-empresas con la service key.

alter table public.empresa
  add column if not exists baja_solicitada_en timestamptz;

create index if not exists idx_empresa_baja_solicitada
  on public.empresa (baja_solicitada_en)
  where baja_solicitada_en is not null;

create or replace function public.purgar_empresa(p_empresa uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pendientes text[];
  tabla text;
  n integer;
  total integer := 0;
  progreso boolean;
  vuelta integer := 0;
begin
  if not exists (
    select 1 from public.empresa
     where id = p_empresa
       and activa = false
       and baja_solicitada_en is not null
       and baja_solicitada_en < now() - interval '30 days'
  ) then
    raise exception 'La empresa % no tiene una baja de más de 30 días', p_empresa;
  end if;

  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}')
    into pendientes
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'empresa_id'
     and t.table_type = 'BASE TABLE'
     and c.table_name <> 'empresa';

  -- Varias vueltas: si una tabla todavía tiene filas que otra referencia
  -- (p. ej. empleados ← fichadas), se reintenta después de borrar la otra.
  loop
    vuelta := vuelta + 1;
    progreso := false;
    foreach tabla in array pendientes loop
      begin
        execute format('delete from public.%I where empresa_id = $1', tabla) using p_empresa;
        get diagnostics n = row_count;
        total := total + n;
        pendientes := array_remove(pendientes, tabla);
        progreso := true;
      exception when foreign_key_violation then
        null; -- queda para la próxima vuelta
      end;
    end loop;
    exit when coalesce(array_length(pendientes, 1), 0) = 0;
    if not progreso or vuelta > 20 then
      raise exception 'No se pudieron borrar las tablas: %', pendientes;
    end if;
  end loop;

  delete from public.empresa where id = p_empresa;
  get diagnostics n = row_count;
  return total + n;
end;
$$;

revoke all on function public.purgar_empresa(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.purgar_empresa(uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purgar_empresa(uuid) to service_role;
  end if;
end $$;

-- Monitoreo del cron nuevo (ver 072)
insert into public.cron_ejecuciones (nombre, ultima_ok)
values ('purgar-empresas', now())
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select column_name, data_type from information_schema.columns
--    where table_name = 'empresa' and column_name = 'baja_solicitada_en';
--   select proname, prosecdef from pg_proc where proname = 'purgar_empresa';
--   select nombre from public.cron_ejecuciones where nombre = 'purgar-empresas';
