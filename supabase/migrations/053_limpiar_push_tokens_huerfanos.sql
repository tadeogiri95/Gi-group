-- ════════════════════════════════════════════════════════════════════
-- 053_limpiar_push_tokens_huerfanos.sql
--
-- push_tokens se relaciona con empleados por (empresa_id, legajo), NO por
-- una FK real a empleados.id — el registro del token (app/lib/push.js)
-- solo tiene legajo disponible en el cliente, no empleado_id. Agregar una
-- FK real exigiría refactorizar esa cadena de llamadas para threadear
-- empleado_id; en cambio, igual que limpiar_sesiones_expiradas (002),
-- se agrega una RPC de limpieza batch que se puede llamar desde el cron
-- semanal /api/cron/limpiar-tokens ya existente.
--
-- Sin esto: borrar/desactivar un empleado deja sus push_tokens huérfanos
-- para siempre (no hay error, pero send-push sigue intentando notificar
-- a un legajo que ya no existe en esa empresa).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION limpiar_push_tokens_huerfanos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_borrados integer;
BEGIN
  DELETE FROM push_tokens pt
   WHERE NOT EXISTS (
     SELECT 1 FROM empleados e
      WHERE e.empresa_id = pt.empresa_id
        AND e.legajo     = pt.legajo
        AND e.activo     = true
   );
  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  RETURN v_borrados;
END;
$$;
