-- 064: Unicidad por empresa en fichadas y empleados (auditoría F3-01, F3-02)
--
-- PROBLEMA (verificado en producción, consulta Q11 de la auditoría):
--   * fichadas_legajo_fecha_unique UNIQUE (legajo, fecha) no incluye empresa_id.
--     Los legajos se repiten entre empresas (todas tienen el legajo 1 = admin),
--     así que el fichaje de una empresa podía bloquear el de otra el mismo día
--     ("Ya fichaste ingreso hoy" en /api/fichar).
--   * empleados_email_key UNIQUE (email) es global: una persona no podía estar
--     en dos empresas, y el error revelaba que el email existía en otra.
--
-- CAMBIO:
--   * fichadas: UNIQUE (empresa_id, empleado_id, fecha), que es lo que el código
--     ya asumía (ver SCHEMA_REFERENCIA.sql).
--   * empleados: UNIQUE (empresa_id, lower(email)) cuando hay email.
--   * empresa: UNIQUE (lower(admin_email)) para conservar la regla actual de
--     "una empresa por email de registro" (empresaSignup.js → EMAIL_TAKEN), que
--     hasta ahora dependía del índice global de empleados. Solo se crea si no
--     hay duplicados existentes.
--   * Se normalizan a minúsculas los emails de empleados (el login ya busca en
--     minúsculas: login-empresa/route.js).
--
-- ANTES DE CORRER: ejecutar los CONTROLES de abajo. Si alguno devuelve filas,
-- NO correr la migración y avisar (hay que resolver duplicados primero).
--
-- ─── CONTROLES PREVIOS (solo lectura) ───────────────────────────────────────
-- C1. Fichadas duplicadas por empresa+empleado+fecha (debe dar 0 filas):
--   select empresa_id, empleado_id, fecha, count(*) from fichadas
--   group by 1,2,3 having count(*) > 1;
-- C2. Emails repetidos dentro de una misma empresa (debe dar 0 filas):
--   select empresa_id, lower(email), count(*) from empleados
--   where email is not null group by 1,2 having count(*) > 1;
-- C3. Funciones de la base que dependan del índice viejo (debe dar 0 filas):
--   select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and prosrc ilike '%on conflict%(legajo%fecha%';
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- 1) fichadas: quitar la unicidad global por (legajo, fecha)
alter table public.fichadas drop constraint if exists fichadas_legajo_fecha_unique;
drop index if exists public.fichadas_legajo_fecha_unique;

create unique index if not exists fichadas_empresa_empleado_fecha_uq
  on public.fichadas (empresa_id, empleado_id, fecha);

-- 2) empleados: email único por empresa (y en minúsculas)
update public.empleados
   set email = lower(trim(email))
 where email is not null
   and email <> lower(trim(email));

alter table public.empleados drop constraint if exists empleados_email_key;
drop index if exists public.empleados_email_key;

create unique index if not exists empleados_empresa_email_uq
  on public.empleados (empresa_id, lower(email))
  where email is not null;

-- 3) empresa: una empresa por email de registro (solo si hoy no hay duplicados)
do $$
begin
  if exists (
    select 1 from public.empresa
     where admin_email is not null
     group by lower(admin_email) having count(*) > 1
  ) then
    raise notice 'Hay admin_email repetidos en empresa: no se crea empresa_admin_email_uq (revisar a mano)';
  else
    create unique index if not exists empresa_admin_email_uq
      on public.empresa (lower(admin_email))
      where admin_email is not null;
  end if;
end $$;

commit;

-- ─── VERIFICACIÓN (debe listar los 3 índices nuevos y ninguno de los viejos) ─
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public'
--     and indexname in ('fichadas_empresa_empleado_fecha_uq', 'empleados_empresa_email_uq',
--                       'empresa_admin_email_uq', 'fichadas_legajo_fecha_unique', 'empleados_email_key');
--
-- ─── REVERSIÓN (solo si algo falla; vuelve a las reglas globales) ───────────
--   begin;
--   drop index if exists public.fichadas_empresa_empleado_fecha_uq;
--   drop index if exists public.empleados_empresa_email_uq;
--   drop index if exists public.empresa_admin_email_uq;
--   create unique index fichadas_legajo_fecha_unique on public.fichadas (legajo, fecha);
--   create unique index empleados_email_key on public.empleados (email);
--   commit;
