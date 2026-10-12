-- 095: RLS real en los datos de la empresa (ítem 37, etapa 2)
--
-- CONTEXTO: con RLS_RUTAS=on (Vercel), /api/empresa (GET con sesión y PATCH)
-- y /api/upload-logo leen y guardan la fila de la empresa con el pase del
-- usuario (rol `authenticated`, claim `eid`) en vez de service_role. La base
-- aplica tenant_isolation_auth_empresa y tenant_isolation_auth_empresa_update
-- (089): cada empresa solo ve y cambia su propia fila.
--
-- La 089/093 ya dan UPDATE en las columnas de marca, logo y prompts. Faltan
-- las que /api/empresa permite editar y se agregaron después (068, 074, 076,
-- 077). Va columna por columna: si alguna no existe, avisa y sigue.
--
-- También rehace (idempotente) la policy de UPDATE de la 089, por si en la
-- base no quedó: la 089 corre en una transacción y en producción se deshizo.
--
-- Quién puede cambiar qué (solo el dueño las reglas y los prompts, sin
-- supervisores de división) lo sigue controlando la ruta.
--
-- ORDEN: correr ANTES de prender RLS_RUTAS=on. Es idempotente y no va en
-- una transacción.

do $$
declare
  columna text;
begin
  foreach columna in array array['reglas_asistencia', 'escaner_ot', 'tipos_solicitud', 'resumen_semanal'] loop
    begin
      execute format('grant update (%I) on public.empresa to authenticated', columna);
    exception when others then
      raise notice 'No se pudo dar UPDATE en empresa.%: %', columna, sqlerrm;
    end;
  end loop;
end $$;

drop policy if exists tenant_isolation_auth_empresa_update on public.empresa;
create policy tenant_isolation_auth_empresa_update on public.empresa
  for update to authenticated
  using (id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
  with check (id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);

-- Verificación (opcional):
-- select column_name from information_schema.column_privileges
--  where grantee = 'authenticated' and table_name = 'empresa' and privilege_type = 'UPDATE'
--  order by 1;
