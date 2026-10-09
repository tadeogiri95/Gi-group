-- 086_resolver_solicitud.sql — Aprobar o rechazar una solicitud en una sola
-- transacción (ítem 38 de fase-7; auditoría F1-12 y F3-13).
--
-- Antes la bandeja lo hacía desde el celular en pasos sueltos: cambiar la
-- solicitud, crear la fichada (permiso de ingreso) o cargar la hora extra, y
-- crear el aviso para el empleado. Un corte a mitad dejaba una solicitud
-- aprobada sin fichada o sin aviso; y si dos personas tocaban "Aprobar" a la
-- vez, se escribía dos veces.
--
-- Ahora el servidor arma lo que hay que escribir y llama a esta función, que:
--   1. bloquea la solicitud (FOR UPDATE) y verifica que siga pendiente;
--   2. la marca aprobada o rechazada;
--   3. crea la fichada del permiso de ingreso (si no había una ese día);
--   4. carga las horas extra en la fichada que corresponde;
--   5. crea el aviso para el empleado.
-- Todo o nada. Devuelve 'ok', 'no_existe' o 'ya_resuelta'.
-- La usa solo el servidor (service_role).

create or replace function public.resolver_solicitud(
  p_empresa      uuid,
  p_id           integer,
  p_estado       text,
  p_aprobador    text,
  p_nota         text,
  p_fichada      jsonb,   -- null o { empleado_id, legajo, fecha, ingreso }
  p_horas_extra  jsonb,   -- null o { fichada_id, horas }
  p_notificacion jsonb    -- { destinatario_rol, asunto, detalle }
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if p_estado not in ('aprobado', 'rechazado') then
    raise exception 'estado inválido: %', p_estado;
  end if;

  select estado into v_estado
    from solicitudes
   where id = p_id and empresa_id = p_empresa
   for update;
  if not found then
    return 'no_existe';
  end if;
  if v_estado is distinct from 'pendiente' then
    return 'ya_resuelta';
  end if;

  update solicitudes
     set estado = p_estado,
         aprobador = p_aprobador,
         resuelto_at = now(),
         notas_gerencia = nullif(p_nota, '')
   where id = p_id and empresa_id = p_empresa;

  if p_fichada is not null then
    insert into fichadas (empleado_id, legajo, fecha, ingreso, llegada_tarde, minutos_tarde, permiso_ingreso, empresa_id)
    select (p_fichada->>'empleado_id')::uuid, (p_fichada->>'legajo')::integer, (p_fichada->>'fecha')::date,
           (p_fichada->>'ingreso')::time, true, 0, true, p_empresa
     where exists (select 1 from empleados where id = (p_fichada->>'empleado_id')::uuid and empresa_id = p_empresa)
    on conflict (empresa_id, empleado_id, fecha) do nothing;
  end if;

  if p_horas_extra is not null then
    update fichadas
       set horas_extra = (p_horas_extra->>'horas')::numeric
     where id = (p_horas_extra->>'fichada_id')::uuid and empresa_id = p_empresa;
  end if;

  insert into notificaciones (destinatario_rol, tipo, asunto, detalle, urgencia, solicitud_id, empresa_id)
  values (p_notificacion->>'destinatario_rol', 'aprobacion', p_notificacion->>'asunto',
          p_notificacion->>'detalle', 'alta', p_id, p_empresa);

  return 'ok';
end;
$$;

revoke all on function public.resolver_solicitud(uuid, integer, text, text, text, jsonb, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.resolver_solicitud(uuid, integer, text, text, text, jsonb, jsonb, jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.resolver_solicitud(uuid, integer, text, text, text, jsonb, jsonb, jsonb) to service_role;
  end if;
end $$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select proname, prosecdef from pg_proc where proname = 'resolver_solicitud';
--   → resolver_solicitud | t
