-- 022: Eliminar policy anon que expone todas las columnas de empresa
-- (incluyendo admin_password hash) a lecturas anónimas.
-- La app usa service_key para todo, así que esta policy no es necesaria.

DROP POLICY IF EXISTS "empresa_publica_por_slug" ON empresa;
