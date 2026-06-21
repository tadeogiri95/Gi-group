-- 027: RPC para crear empresa + admin atómicamente.
-- Reemplaza los dos POSTs secuenciales en registro-empresa/route.js
-- que podían dejar una empresa huérfana si el INSERT del empleado fallaba.

CREATE OR REPLACE FUNCTION rpc_crear_empresa_con_admin(
  p_nombre_empresa text,
  p_nombre_corto text,
  p_admin_email text,
  p_admin_password text,
  p_rubro text,
  p_slug text,
  p_admin_nombre text,
  p_email_verify_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_empresa_id uuid;
  v_empleado_id uuid;
BEGIN
  INSERT INTO empresa (
    nombre, nombre_corto, admin_email, admin_password,
    rubro, slug, plan_activo, trial_usado, max_empleados,
    activa, email_verificado, email_verify_token
  ) VALUES (
    p_nombre_empresa, p_nombre_corto, p_admin_email, p_admin_password,
    p_rubro, p_slug, 'trial', true, 10,
    true, false, p_email_verify_token
  )
  RETURNING id INTO v_empresa_id;

  INSERT INTO empleados (
    nombre, apodo, legajo, email, password,
    rol, area, division, activo, empresa_id,
    debe_cambiar_password
  ) VALUES (
    p_admin_nombre, split_part(p_admin_nombre, ' ', 1), 1, p_admin_email, p_admin_password,
    'gerencial', 'administración', 'general', true, v_empresa_id,
    false
  )
  RETURNING id INTO v_empleado_id;

  RETURN jsonb_build_object(
    'empresa_id', v_empresa_id,
    'empleado_id', v_empleado_id
  );
END;
$$;
