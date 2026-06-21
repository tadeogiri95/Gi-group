-- 038: Recrear policy anon para empresa con restricción de columnas.
--
-- La policy original (004) exponía TODAS las columnas (incluyendo admin_password).
-- La 022 la eliminó. Ahora recreamos una versión segura usando una
-- SECURITY DEFINER function que solo devuelve campos públicos.
--
-- Esto permite futuros endpoints públicos (branding en login) sin riesgo.

-- Función que retorna solo las columnas seguras de una empresa por slug
CREATE OR REPLACE FUNCTION public.empresa_publica(p_slug text)
RETURNS TABLE (
  id uuid,
  slug text,
  nombre text,
  logo_url text,
  color_primario text,
  color_secundario text,
  rubro text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id, slug, nombre, logo_url, color_primario, color_secundario, rubro
  FROM empresa
  WHERE slug = p_slug AND activa = true
  LIMIT 1;
$$;

-- Revocar acceso directo anon a la tabla (no debería haber policy, pero por seguridad)
DROP POLICY IF EXISTS "empresa_publica_por_slug" ON empresa;

-- No crear policy SELECT para anon en empresa — el acceso público
-- solo debe pasar por la función empresa_publica() que filtra columnas.

COMMENT ON FUNCTION public.empresa_publica IS
  'Retorna datos públicos de una empresa por slug. No expone admin_password ni tokens.';
