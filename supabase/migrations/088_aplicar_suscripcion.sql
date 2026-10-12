-- 088_aplicar_suscripcion.sql — Cambios de suscripción y plan en una sola
-- transacción (ítem 38 de fase-7, parte 3; auditoría F3-13).
--
-- El aviso de Mercado Pago (/api/billing/webhook) hacía en pedidos sueltos:
-- cambiar la suscripción, cancelar las otras de la empresa y cambiar el plan
-- de la empresa. Un corte a mitad dejaba, por ejemplo, la suscripción activa
-- con la empresa todavía en el plan gratis, o dos suscripciones activas; y
-- dos avisos simultáneos podían pisarse.
--
-- Esta función bloquea la suscripción y la empresa y hace todo junto:
--   1. cambia el estado de la suscripción (y los datos del período, si vienen);
--      si ya estaba en ese estado y es un aviso de suscripción, no toca nada;
--   2. activa:   cancela las otras suscripciones vigentes de la empresa (si
--                se pide) y pone el plan, salvo que el superadmin lo fije a mano;
--   3. suspendida/cancelada: deja el plan hasta el fin del período pago o
--                pasa a gratis, salvo el plan fijado a mano.
-- Devuelve { ok, sin_cambios?, override, plan, canceladas: [ids de MP] }:
-- el servidor cancela esas en Mercado Pago después de guardar.
-- La usa solo el servidor (service_role).

create or replace function public.aplicar_suscripcion(
  p_empresa        uuid,
  p_susc           uuid,
  p_estado         text,
  p_datos          jsonb,        -- null (aviso de pago) o { gateway_customer_id, periodo_inicio, periodo_fin }
  p_cancelar_otras boolean,
  p_plan_vence     timestamptz   -- fin del período pago, para suspendida/cancelada
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_susc       suscripciones;
  v_override   boolean;
  v_canceladas text[] := '{}';
begin
  if p_estado not in ('activa', 'suspendida', 'cancelada') then
    raise exception 'estado inválido: %', p_estado;
  end if;

  select * into v_susc from suscripciones
   where id = p_susc and empresa_id = p_empresa
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'tipo', 'no_existe');
  end if;

  select coalesce(plan_override_manual, false) into v_override
    from empresa where id = p_empresa
   for update;

  -- Aviso de suscripción repetido (o dos a la vez): el segundo no hace nada
  if p_datos is not null and v_susc.estado = p_estado then
    return jsonb_build_object('ok', true, 'sin_cambios', true, 'override', v_override, 'plan', v_susc.plan);
  end if;

  if p_datos is not null then
    update suscripciones
       set estado = p_estado,
           gateway_customer_id = p_datos->>'gateway_customer_id',
           periodo_inicio = (p_datos->>'periodo_inicio')::timestamptz,
           periodo_fin = (p_datos->>'periodo_fin')::timestamptz
     where id = p_susc;
  else
    update suscripciones set estado = p_estado where id = p_susc;
  end if;

  if p_estado = 'activa' then
    if p_cancelar_otras then
      with otras as (
        update suscripciones
           set estado = 'cancelada'
         where empresa_id = p_empresa and estado in ('trial', 'activa') and id <> p_susc
        returning gateway_subscription_id
      )
      select coalesce(array_agg(gateway_subscription_id) filter (where gateway_subscription_id is not null), '{}')
        into v_canceladas from otras;
    end if;
    if not v_override then
      update empresa
         set plan_activo = v_susc.plan,
             suscripcion_activa_id = p_susc,
             plan_vence = null,
             addons = v_susc.addons
       where id = p_empresa;
    end if;
  elsif not v_override then
    if p_plan_vence is not null and p_plan_vence > now() then
      -- Período de gracia: el plan sigue hasta el fin de lo ya pagado
      update empresa set plan_vence = p_plan_vence, suscripcion_activa_id = null where id = p_empresa;
    else
      update empresa set plan_activo = 'free', suscripcion_activa_id = null, plan_vence = null where id = p_empresa;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'override', v_override, 'plan', v_susc.plan, 'canceladas', to_jsonb(v_canceladas));
end;
$$;

revoke all on function public.aplicar_suscripcion(uuid, uuid, text, jsonb, boolean, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.aplicar_suscripcion(uuid, uuid, text, jsonb, boolean, timestamptz) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.aplicar_suscripcion(uuid, uuid, text, jsonb, boolean, timestamptz) to service_role;
  end if;
end $$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select proname, prosecdef from pg_proc where proname = 'aplicar_suscripcion';
--   → aplicar_suscripcion | t
