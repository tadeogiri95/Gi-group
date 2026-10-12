-- 093: permisos de `authenticated` para /api/data (arreglo de la 089)
--
-- CONTEXTO: la 089 corre entera dentro de una transacción. En producción
-- falló una línea y se deshizo todo, incluidos los GRANT: al prender
-- RLS_API_DATA=on la app daba "permission denied" (42501) en fichadas,
-- solicitudes y notificaciones. El 2026-10-12 se arregló corriendo a mano
-- este mismo bloque; esta migración lo deja guardado.
--
-- Es la misma lista de permisos que la 089 (lo que usa el gateway por tabla,
-- ver POLICY en app/lib/dataPolicy.js), pero tolerante: si falta una tabla o
-- una columna, avisa y sigue, en vez de deshacer todo.
-- tests/rls-api-data.test.js verifica que acompañe a POLICY.
--
-- ORDEN: se puede correr en cualquier momento. Es idempotente: en producción
-- ya está aplicada (no cambia nada si se vuelve a correr).

do $$
declare
  p record;
begin
  for p in select * from (values
    ('empleados', 'select, update'),
    ('fichadas', 'select, insert, update'),
    ('solicitudes', 'select, insert, update'),
    ('notificaciones', 'select, insert, update'),
    ('registro_actividades', 'select, insert, update'),
    ('reportes_obra', 'select, insert, update'),
    ('mensajes_chat', 'select, insert'),
    ('push_tokens', 'select, insert, update, delete'),
    ('turnos_planificados', 'select, insert, update, delete'),
    ('documentos_exigidos_empleado', 'select, insert, delete'),
    ('documentos_empleado', 'select'),
    ('proyectos', 'select, insert, update, delete'),
    ('geo_zonas', 'select, insert, update, delete'),
    ('reglas_bot', 'select, insert, update, delete'),
    ('tipos_documento_requerido', 'select, insert, update'),
    ('etapas', 'select'),
    ('divisiones', 'select'),
    ('config_sistema', 'select, insert, update'),
    ('notas_calendario', 'select, insert, update, delete'),
    ('geo_registros', 'select'),
    ('suscripciones', 'select'),
    ('pagos', 'select'),
    ('empresa', 'select')
  ) as t(tabla, permisos) loop
    if to_regclass('public.' || p.tabla) is not null then
      execute format('grant %s on public.%I to authenticated', p.permisos, p.tabla);
    else
      raise notice 'FALTA la tabla %', p.tabla;
    end if;
  end loop;

  begin
    execute 'grant update (nombre, nombre_corto, rubro, color_primario, color_secundario, color_fondo, color_texto, typography, theme_preset, logo_url, prompt_ia_obra, prompt_ia_chat, timezone, onboarding_completado) on public.empresa to authenticated';
  exception when others then
    raise notice 'No se pudo dar UPDATE en empresa: %', sqlerrm;
  end;

  execute 'grant usage, select on all sequences in schema public to authenticated';

  if to_regprocedure('public.asignar_planta_principal()') is not null then
    execute 'alter function public.asignar_planta_principal() security definer';
    execute 'alter function public.asignar_planta_principal() set search_path = public, pg_temp';
  end if;
end $$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Permisos de authenticated por tabla (deberían ser 23 filas):
--   select table_name, string_agg(privilege_type, ', ' order by privilege_type) as permisos
--   from information_schema.role_table_grants
--   where grantee = 'authenticated' and table_schema = 'public'
--   group by table_name order by table_name;
