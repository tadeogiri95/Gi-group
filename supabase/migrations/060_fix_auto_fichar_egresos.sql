-- 060: Fix auto_fichar_egresos() — la función no cerraba nada en la práctica.
--
-- El cron (vercel.json, "0 3 * * *" UTC = 00:00 ART) llamaba a esta función
-- justo al empezar el día y el filtro buscaba fichadas de "hoy" — un día
-- que recién arrancaba, así que nunca había nada que calzara. Tres bugs
-- corregidos en la misma función:
--   1. Filtro de fecha: debe buscar fichadas de días ANTERIORES a hoy
--      (con techo de 3 días, para no tocar fichadas viejísimas si el cron
--      estuvo caído — esas se resuelven a mano), no de "hoy".
--   2. v_dia_key: debe calcularse del día de semana de f.fecha (el día al
--      que pertenece la fichada abierta), no del día de semana de "ahora"
--      — si no, compara contra el horario de un día equivocado.
--   3. Aritmética de horas: la resta original era "hora del día" sin
--      fecha (v_hora_out::time - ingreso::time), que da negativo en
--      cualquier turno nocturno (ingreso 22:00, salida 06:00 → -16h).
--      Ahora usa timestamp completo (fecha + hora) en ambos extremos,
--      mismo enfoque que ya usa correctamente app/api/fichar/route.js
--      (líneas 276-278) para el cierre manual.

CREATE OR REPLACE FUNCTION auto_fichar_egresos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp           record;
  v_dia_key       text;
  v_hora_out      text;
  v_cerradas      integer := 0;
  v_out_ts        timestamp;
BEGIN
  FOR v_emp IN
    SELECT e.id, e.legajo, e.empresa_id, e.diagrama,
           f.id AS fichada_id, f.ingreso, f.fecha AS fichada_fecha,
           COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires') AS tz
      FROM empleados e
      JOIN fichadas f
        ON f.empleado_id = e.id
       AND f.ingreso IS NOT NULL
       AND f.egreso  IS NULL
      JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.activo = true
       AND f.fecha <  (now() AT TIME ZONE COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires'))::date
       AND f.fecha >= (now() AT TIME ZONE COALESCE(emp.timezone, 'America/Argentina/Buenos_Aires'))::date - interval '3 days'
  LOOP
    -- El día de semana de la fichada (no el de "ahora") decide qué
    -- horario de diagrama le corresponde.
    v_dia_key := CASE EXTRACT(DOW FROM v_emp.fichada_fecha)
      WHEN 0 THEN 'dom' WHEN 1 THEN 'lun' WHEN 2 THEN 'mar'
      WHEN 3 THEN 'mie' WHEN 4 THEN 'jue' WHEN 5 THEN 'vie'
      WHEN 6 THEN 'sab' END;

    v_hora_out := v_emp.diagrama -> v_dia_key ->> 'out';

    IF v_hora_out IS NOT NULL THEN
      -- Timestamp completo de cierre: fecha de la fichada + hora de
      -- salida programada. Si esa hora es <= la hora de ingreso, el
      -- turno cruzó medianoche → el cierre cae un día después.
      v_out_ts := (v_emp.fichada_fecha || ' ' || v_hora_out)::timestamp;
      IF v_hora_out::time <= v_emp.ingreso::time THEN
        v_out_ts := v_out_ts + interval '1 day';
      END IF;

      -- Comparación en timestamp completo (no "hora suelta del día",
      -- que es lo que rompía turnos nocturnos) contra el reloj actual.
      IF (now() AT TIME ZONE v_emp.tz) > (v_out_ts + interval '15 minutes') THEN
        UPDATE fichadas
           SET egreso = v_hora_out::time,
               horas_trabajadas = ROUND(
                 EXTRACT(EPOCH FROM (
                   v_out_ts - (v_emp.fichada_fecha || ' ' || v_emp.ingreso)::timestamp
                 )) / 3600.0, 2
               )
         WHERE id = v_emp.fichada_id;

        UPDATE registro_actividades
           SET hora_fin = v_out_ts AT TIME ZONE v_emp.tz
         WHERE empleado_id = v_emp.id
           AND hora_fin IS NULL;

        v_cerradas := v_cerradas + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cerradas', v_cerradas, 'ts', now());
END;
$$;

-- ─── VERIFICACIÓN MANUAL ────────────────────────────────────────────────
-- El entorno donde se escribió este fix no tiene conexión directa a
-- Postgres (sin psql/DATABASE_URL) — no se pudo ejecutar esta función
-- contra una base real. Antes de confiar en este fix, correr a mano en
-- el SQL Editor de Supabase:
--
-- 1. Tomar un empleado real activo y anotar su diagrama para algún día
--    de semana (ej. "lun": {"in":"08:00","out":"17:00"}).
-- 2. Crear una fichada de prueba abierta, fechada ese día de la semana
--    pasado (no hoy), con ingreso acorde al diagrama:
--      insert into fichadas (empresa_id, empleado_id, legajo, fecha, ingreso)
--      values ('<empresa_id>', '<empleado_id>', <legajo>,
--              '<fecha_de_un_lunes_pasado>', '08:00');
-- 3. Ejecutar: select auto_fichar_egresos();
--    Debe devolver {"cerradas": 1, ...} (o más, si hay otras fichadas
--    abiertas viejas).
-- 4. Confirmar que esa fichada quedó cerrada correctamente:
--      select fecha, ingreso, egreso, horas_trabajadas from fichadas
--      where id = '<id_de_la_fichada_de_prueba>';
--    horas_trabajadas debe ser positivo y cercano a las horas de diagrama
--    (ej. ~9h para 08:00→17:00), nunca negativo ni null.
-- 5. Repetir con un caso de turno nocturno (ingreso "22:00", diagrama.out
--    "06:00") y confirmar que horas_trabajadas sale positivo (~8h), no
--    negativo — ese es el escenario que más se quería corregir.
