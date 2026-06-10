-- ═══════════════════════════════════════════════════════════════════
-- 009_timezone_auto_fichaje.sql
-- Actualiza auto_fichar_egresos para respetar el timezone de cada empresa
-- en vez de asumir UTC/servidor.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_fichar_egresos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp           record;
  v_dia_key       text;
  v_hora_out      text;
  v_hora_actual   time;
  v_fecha_local   date;
  v_cerradas      integer := 0;
BEGIN
  FOR v_emp IN
    SELECT e.id, e.legajo, e.empresa_id, e.diagrama,
           f.id AS fichada_id, f.ingreso,
           COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires') AS tz
      FROM empleados e
      JOIN fichadas f
        ON f.empleado_id = e.id
       AND f.ingreso IS NOT NULL
       AND f.egreso  IS NULL
      JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.activo = true
       -- Solo fichadas del día local de la empresa
       AND f.fecha = (now() AT TIME ZONE COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires'))::date
  LOOP
    -- Hora y día local según timezone de la empresa
    v_hora_actual := (now() AT TIME ZONE v_emp.tz)::time;
    v_fecha_local := (now() AT TIME ZONE v_emp.tz)::date;

    v_dia_key := CASE EXTRACT(DOW FROM now() AT TIME ZONE v_emp.tz)
      WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
      WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie'
      WHEN 6 THEN 'sab' END;

    v_hora_out := v_emp.diagrama -> v_dia_key ->> 'out';

    IF v_hora_out IS NOT NULL
       AND v_hora_actual > (v_hora_out::time + interval '15 minutes') THEN

      UPDATE fichadas
         SET egreso = v_hora_out::time,
             horas_trabajadas = ROUND(
               EXTRACT(EPOCH FROM (v_hora_out::time - v_emp.ingreso::time)) / 3600.0, 2
             )
       WHERE id = v_emp.fichada_id;

      UPDATE registro_actividades
         SET hora_fin = (v_fecha_local || ' ' || v_hora_out)::timestamptz
       WHERE empleado_id = v_emp.id
         AND hora_fin IS NULL;

      v_cerradas := v_cerradas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cerradas', v_cerradas, 'ts', now());
END;
$$;
