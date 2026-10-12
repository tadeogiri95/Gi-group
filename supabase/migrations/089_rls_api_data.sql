-- 089: RLS real para /api/data, primera etapa (ítem 37: F0-06, F2-14, F3-06)
--
-- CONTEXTO: /api/data entraba siempre con service_role, que se saltea la RLS.
-- Con RLS_API_DATA=on (Vercel) la consulta principal pasa a ir con un pase
-- corto firmado con SUPABASE_JWT_SECRET (rol `authenticated`, claim `eid`),
-- y la base aplica las policies tenant_isolation_auth_* por su cuenta.
-- El gateway sigue filtrando por empresa, rol y división: son dos barreras.
--
-- Esta migración:
--   1. Rehace (idempotente) las policies de aislamiento de 050/058, por si el
--      esquema de producción se desvió (F0-05).
--   2. Agrega la policy de UPDATE en empresa (050 solo tenía SELECT).
--   3. Da a `authenticated` solo los permisos que el gateway usa por tabla
--      (ver POLICY en app/lib/dataPolicy.js). Sin TRUNCATE (no respeta RLS).
--      Si POLICY cambia, este GRANT tiene que acompañarlo
--      (tests/rls-api-data.test.js lo verifica).
--   4. Hace SECURITY DEFINER al trigger que asigna la planta principal: lee
--      `plantas`, que `authenticated` no puede leer.
--
-- Las vistas v_resumen_diario y v_scores_empleados quedan como están: el
-- gateway las sigue leyendo con service_role (una vista materializada no
-- admite RLS).
--
-- ORDEN: correr ANTES de prender RLS_API_DATA=on. Con el interruptor apagado
-- no cambia nada visible: nadie usa el rol `authenticated` todavía.

begin;

-- ─── 1 y 2. Policies de aislamiento por empresa ────────────────────────────
do $$
declare
  tabla text;
  tablas text[] := array[
    'empleados', 'fichadas', 'solicitudes', 'notificaciones',
    'registro_actividades', 'reportes_obra', 'push_tokens',
    'config_sistema', 'notas_calendario', 'mensajes_chat', 'turnos_planificados',
    'etapas', 'divisiones', 'geo_zonas', 'geo_registros',
    'reglas_bot', 'proyectos', 'invitaciones_empresa',
    'suscripciones', 'pagos',
    'tipos_documento_requerido', 'documentos_exigidos_empleado', 'documentos_empleado'
  ];
begin
  foreach tabla in array tablas loop
    if to_regclass('public.' || tabla) is not null then
      execute format('alter table public.%I enable row level security', tabla);
      execute format('drop policy if exists %I on public.%I', 'tenant_isolation_auth_' || tabla, tabla);
      execute format(
        'create policy %I on public.%I for all to authenticated '
        || 'using (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid) '
        || 'with check (empresa_id = (current_setting(''request.jwt.claims'', true)::json->>''eid'')::uuid)',
        'tenant_isolation_auth_' || tabla, tabla
      );
    else
      raise notice 'Tabla % no existe, se saltea', tabla;
    end if;
  end loop;
end $$;

alter table public.empresa enable row level security;
drop policy if exists tenant_isolation_auth_empresa on public.empresa;
create policy tenant_isolation_auth_empresa on public.empresa
  for select to authenticated
  using (id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
drop policy if exists tenant_isolation_auth_empresa_update on public.empresa;
create policy tenant_isolation_auth_empresa_update on public.empresa
  for update to authenticated
  using (id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);

-- ─── 3. Permisos de `authenticated`: lo que usa el gateway, nada más ───────
grant select, update                 on public.empleados                    to authenticated;
grant select, insert, update         on public.fichadas                     to authenticated;
grant select, insert, update         on public.solicitudes                  to authenticated;
grant select, insert, update         on public.notificaciones               to authenticated;
grant select, insert, update         on public.registro_actividades         to authenticated;
grant select, insert, update         on public.reportes_obra                to authenticated;
grant select, insert                 on public.mensajes_chat                to authenticated;
grant select, insert, update, delete on public.push_tokens                  to authenticated;
grant select, insert, update, delete on public.turnos_planificados          to authenticated;
grant select, insert, delete         on public.documentos_exigidos_empleado to authenticated;
grant select                         on public.documentos_empleado          to authenticated;
grant select, insert, update, delete on public.proyectos                    to authenticated;
grant select, insert, update, delete on public.geo_zonas                    to authenticated;
grant select, insert, update, delete on public.reglas_bot                   to authenticated;
grant select, insert, update         on public.tipos_documento_requerido    to authenticated;
grant select                         on public.etapas                       to authenticated;
grant select                         on public.divisiones                   to authenticated;
grant select, insert, update         on public.config_sistema               to authenticated;
grant select, insert, update, delete on public.notas_calendario             to authenticated;
grant select                         on public.geo_registros                to authenticated;
grant select                         on public.suscripciones                to authenticated;
grant select                         on public.pagos                        to authenticated;

-- empresa: lectura de la propia y edición solo de las columnas de
-- configuración que acepta el gateway (CAMPOS_PERMITIDOS.empresa.PATCH).
grant select on public.empresa to authenticated;
grant update (nombre, nombre_corto, rubro, color_primario, color_secundario, color_fondo,
              color_texto, typography, theme_preset, logo_url, prompt_ia_obra,
              prompt_ia_chat, timezone, onboarding_completado)
  on public.empresa to authenticated;

-- Los inserts con id serial necesitan usar la secuencia.
grant usage, select on all sequences in schema public to authenticated;

-- ─── 4. Trigger de planta principal ────────────────────────────────────────
alter function public.asignar_planta_principal() security definer;
alter function public.asignar_planta_principal() set search_path = public, pg_temp;

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Toda tabla del gateway tiene su policy (debería devolver al menos 25 filas):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and policyname like 'tenant_isolation_auth_%'
--   order by tablename;
-- Ninguna policy permisiva para authenticated (debería devolver 0 filas):
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and roles && array['public','authenticated']::name[]
--     and (qual = 'true' or with_check = 'true');
-- Nada para anon (debería devolver 0 filas):
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
