-- 087_registrar_actividad.sql — Empezar o terminar una tarea en una sola
-- transacción (ítem 38 de fase-7, parte 2; auditoría F1-12).
--
-- /api/actividad cerraba lo que hubiera abierto y después creaba la tarea
-- nueva en pedidos separados. Dos toques casi a la vez (o un reintento del
-- celular al recuperar señal mientras se tocaba de nuevo) podían leer "nada
-- abierto" los dos y dejar dos tareas abiertas; un corte entre el cierre y
-- el alta dejaba al operario sin tarea.
--
-- Esta función, por empleado y de a una por vez (advisory lock):
--   1. si ya hay una tarea empezada DESPUÉS del momento pedido (algo hecho
--      sin conexión que llegó tarde), no toca nada: 'desfasada';
--   2. cierra todas las abiertas en ese momento, con su duración;
--   3. si es "iniciar", crea la nueva.
-- Todo o nada. La usa solo el servidor (service_role).

create or replace function public.registrar_actividad(
  p_empresa       uuid,
  p_empleado      uuid,
  p_instante      timestamptz,
  p_observaciones text,    -- se guardan en lo que se cierra (solo al finalizar)
  p_nueva         jsonb    -- null para finalizar; si no: { legajo, fecha, codigo_proyecto, etapa, tipo, causa, division }
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cerradas integer;
  v_tarea    registro_actividades;
begin
  -- De a una operación por empleado: la segunda espera a que termine la primera
  perform pg_advisory_xact_lock(hashtextextended('registrar_actividad:' || p_empleado::text, 0));

  if not exists (select 1 from empleados where id = p_empleado and empresa_id = p_empresa) then
    return jsonb_build_object('ok', false, 'tipo', 'sin_empleado');
  end if;

  if exists (select 1 from registro_actividades
              where empleado_id = p_empleado and empresa_id = p_empresa
                and hora_fin is null and hora_inicio > p_instante) then
    return jsonb_build_object('ok', false, 'tipo', 'desfasada');
  end if;

  update registro_actividades
     set hora_fin = p_instante,
         duracion_min = greatest(0, round((extract(epoch from (p_instante - hora_inicio)) / 60)::numeric, 1)),
         observaciones = case when p_nueva is null and nullif(p_observaciones, '') is not null
                              then p_observaciones else observaciones end
   where empleado_id = p_empleado and empresa_id = p_empresa and hora_fin is null;
  get diagnostics v_cerradas = row_count;

  if p_nueva is null then
    return jsonb_build_object('ok', true, 'cerradas', v_cerradas);
  end if;

  insert into registro_actividades (empleado_id, legajo, fecha, hora_inicio, codigo_proyecto, etapa, tipo, causa, division, empresa_id)
  values (p_empleado, p_nueva->>'legajo', (p_nueva->>'fecha')::date, p_instante,
          p_nueva->>'codigo_proyecto', (p_nueva->>'etapa')::smallint,
          coalesce(p_nueva->>'tipo', 'N'), p_nueva->>'causa',
          coalesce(nullif(p_nueva->>'division', ''), 'general'), p_empresa)
  returning * into v_tarea;

  return jsonb_build_object('ok', true, 'cerradas', v_cerradas, 'tarea', to_jsonb(v_tarea));
end;
$$;

revoke all on function public.registrar_actividad(uuid, uuid, timestamptz, text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.registrar_actividad(uuid, uuid, timestamptz, text, jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.registrar_actividad(uuid, uuid, timestamptz, text, jsonb) to service_role;
  end if;
end $$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select proname, prosecdef from pg_proc where proname = 'registrar_actividad';
--   → registrar_actividad | t
