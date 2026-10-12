-- 094: RLS real en las rutas de documentos (ítem 37, etapa 2)
--
-- CONTEXTO: con RLS_RUTAS=on (Vercel), /api/documentos/{upload, sign-url,
-- asignar, mis-documentos} consultan la base con el pase del usuario (rol
-- `authenticated`, claim `eid`) en vez de service_role, y la base aplica las
-- policies tenant_isolation_auth_* (089): una empresa no ve ni toca filas
-- de otra aunque el código tuviera un error.
--
-- Casi todo lo que usan estas rutas ya lo da la 089/093. Falta solo que
-- /api/documentos/upload pueda registrar el archivo subido y borrar el que
-- reemplaza. /api/data sigue sin poder escribir documentos_empleado: lo
-- bloquea en el código (TABLAS_SOLO_LECTURA) y POLICY no lo permite.
--
-- Los archivos en sí (Storage) siguen con service_role: el bucket es privado
-- y las rutas validan dueño, empresa y alcance antes de tocarlo.
--
-- ORDEN: correr ANTES de prender RLS_RUTAS=on. Es idempotente y no va en una
-- transacción: si la tabla no existe, avisa y sigue.

do $$
begin
  if to_regclass('public.documentos_empleado') is not null then
    grant select, insert, delete on public.documentos_empleado to authenticated;
  else
    raise notice 'Tabla documentos_empleado no existe, se saltea';
  end if;
end $$;

-- Verificación (opcional):
-- select privilege_type from information_schema.role_table_grants
--  where grantee = 'authenticated' and table_name = 'documentos_empleado';
