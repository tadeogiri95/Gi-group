-- 080_trial_30_dias.sql — Solo versión paga con prueba de 30 días (D20, ítem 25).
--
-- Antes (063): la empresa nueva arrancaba en plan Free, sin límite de tiempo,
-- y la prueba de Pro era de 14 días y había que iniciarla a mano.
-- Ahora: la prueba arranca sola al registrarse y dura 30 días; al vencer, la
-- cuenta queda en pausa (plan_activo = 'free' pasa a significar "sin plan
-- vigente") hasta que se elige un plan.
--
-- 1. iniciar_trial_pro(): 30 días y deja plan_activo = 'trial'.
-- 2. Transición: las empresas que hoy están en 'free' (sin plan manual del
--    superadmin) reciben una prueba de 30 días desde hoy, para que nadie
--    quede bloqueado de golpe. Es idempotente: después ya no están en 'free'.

create or replace function public.iniciar_trial_pro(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  trial_id uuid;
  ya_uso boolean;
begin
  select trial_usado into ya_uso from empresa where id = p_empresa_id;
  if ya_uso then
    return null;
  end if;

  update suscripciones set estado = 'cancelada'
   where empresa_id = p_empresa_id and estado in ('activa', 'trial');

  insert into suscripciones (empresa_id, plan, estado, trial_inicio, trial_fin, precio, moneda, gateway)
  values (p_empresa_id, 'pro', 'trial', now(), now() + interval '30 days', 0, 'ARS', 'manual')
  returning id into trial_id;

  update empresa
     set plan_activo = 'trial', suscripcion_activa_id = trial_id, trial_usado = true
   where id = p_empresa_id;

  return trial_id;
end;
$$;

revoke all on function public.iniciar_trial_pro(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.iniciar_trial_pro(uuid) to service_role;
  end if;
end $$;

-- Transición de las empresas que hoy están en Free
with en_free as (
  select id from public.empresa
   where plan_activo = 'free'
     and coalesce(plan_override_manual, false) = false
     and coalesce(activa, true) = true
),
canceladas as (
  update public.suscripciones s set estado = 'cancelada'
   where s.empresa_id in (select id from en_free) and s.estado in ('activa', 'trial')
  returning s.id
),
nuevas as (
  insert into public.suscripciones (empresa_id, plan, estado, trial_inicio, trial_fin, precio, moneda, gateway)
  select id, 'pro', 'trial', now(), now() + interval '30 days', 0, 'ARS', 'manual' from en_free
  returning id, empresa_id
)
update public.empresa e
   set plan_activo = 'trial', suscripcion_activa_id = n.id, trial_usado = true
  from nuevas n
 where e.id = n.empresa_id;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select plan_activo, count(*) from public.empresa group by plan_activo;   -- no debería quedar 'free' salvo planes manuales
--   select prosrc like '%30 days%' as treinta_dias from pg_proc where proname = 'iniciar_trial_pro';  -- true
