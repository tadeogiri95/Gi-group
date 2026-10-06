-- 066: Limpieza de la base después del incidente F2-00 (auditoría F2-00, F2-04, H13, H14)
--
-- CONTEXTO: hasta la contención, los roles públicos de Supabase (anon y
-- authenticated) podían leer y escribir casi todas las tablas, gracias a
-- permisos amplios + policies "{public} ... true". La contención (REVOKE)
-- ya cerró el acceso. Esta migración limpia lo que quedó:
--
--   1. Borra las policies permisivas (USING true / WITH CHECK true). Hoy no
--      hacen nada (los roles públicos no tienen permisos), pero son una trampa:
--      si alguien vuelve a dar un GRANT, la base queda abierta otra vez.
--   2. Activa RLS en las tablas que no la tenían (rate_limits, login_attempts…).
--      La app entra con service_role, que no se ve afectado.
--   3. Fija search_path en todas las funciones SECURITY DEFINER.
--   4. Quita el DEFAULT 'gigroup2025' de empleados.password (H13) y borra la
--      columna obsoleta con datos del piloto (H14).
--   5. Cierra todas las sesiones y pide cambio de contraseña a todas las
--      cuentas activas (por si alguien copió los hashes mientras estuvo abierta).
--
-- ORDEN: se puede correr en cualquier momento; no depende del código del PR.
-- Efecto visible: todos (vos incluido) tienen que volver a iniciar sesión y
-- elegir una contraseña nueva.

-- ─── PASO 1 (opcional, solo lectura): ver qué se va a borrar ────────────────
--   select tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and roles && array['public','anon','authenticated']::name[]
--     and (qual = 'true' or with_check = 'true')
--   order by tablename, policyname;

-- ─── PASO 2: la limpieza ────────────────────────────────────────────────────
begin;

-- 1. Policies permisivas
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles && array['public','anon','authenticated']::name[]
      and (qual = 'true' or with_check = 'true')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'policy borrada: %.%', p.tablename, p.policyname;
  end loop;
end $$;

-- 2. RLS activa en todas las tablas de public
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'RLS activada: %', t.relname;
  end loop;
end $$;

-- 3. search_path fijo en funciones SECURITY DEFINER
--    (incluye "extensions" porque en Supabase ahí viven pgcrypto y otras)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.firma);
  end loop;
end $$;

-- 4. Defaults y columnas del piloto
alter table public.empleados alter column password drop default;
alter table public.empleados drop column if exists _deprecated_ubicacion_fichaje;

-- 5. Sesiones cerradas y cambio de contraseña obligatorio
update public.sesiones set revocada = true where revocada = false;
update public.empleados set debe_cambiar_password = true where activo = true;

-- Reafirmar la contención (idempotente): nada para los roles públicos
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;

commit;

-- ─── VERIFICACIÓN (las 4 consultas deben devolver 0) ────────────────────────
--   select count(*) as policies_permisivas from pg_policies
--   where schemaname = 'public' and roles && array['public','anon','authenticated']::name[]
--     and (qual = 'true' or with_check = 'true');
--
--   select count(*) as tablas_sin_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
--
--   select count(*) as funciones_sin_search_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
--
--   select count(*) as defaults_inseguros from information_schema.columns
--   where table_schema = 'public' and table_name = 'empleados'
--     and (column_default like '%gigroup2025%' or column_name = '_deprecated_ubicacion_fichaje');
--
-- ─── REVERSIÓN ──────────────────────────────────────────────────────────────
-- No hace falta: las policies borradas no daban acceso a nada (los roles
-- públicos no tienen permisos) y la app usa service_role, que ignora RLS.
-- La columna borrada solo tenía coordenadas de prueba del piloto.
