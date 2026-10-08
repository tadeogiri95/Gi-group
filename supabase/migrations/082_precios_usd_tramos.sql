-- 082_precios_usd_tramos.sql — Precios en USD por tramos de operarios + add-ons (D16, D18, ítem 25).
--
-- 1. Planes nuevos: Asistencia y Planta, cada uno en tramos de 15, 40 y 80
--    operarios activos ("asistencia_15" … "planta_80"). Starter y Pro siguen
--    aceptándose para las suscripciones que ya existían.
-- 2. Add-ons por empresa (empresa.addons): 'ia' (Asistente IA) y 'campo'
--    (Trabajo en campo). Solo los escribe el servidor al confirmarse el pago.
-- 3. La suscripción guarda el precio en USD, la cotización usada y los
--    add-ons. Cuando la cotización se mueve, el precio en pesos nuevo queda
--    programado (precio_nuevo / precio_nuevo_desde) con 30 días de aviso
--    antes de cambiar el cobro en Mercado Pago.
-- 4. cotizaciones: el tipo de cambio de referencia de cada día (lo guarda el
--    cron actualizar-precios). Solo la usa el servidor.

alter table public.suscripciones drop constraint if exists suscripciones_plan_check;
alter table public.suscripciones add constraint suscripciones_plan_check check (plan in (
  'free', 'starter', 'pro', 'enterprise',
  'asistencia_15', 'asistencia_40', 'asistencia_80',
  'planta_15', 'planta_40', 'planta_80'
));

alter table public.suscripciones
  add column if not exists precio_usd numeric(10,2),
  add column if not exists cotizacion numeric(12,4),
  add column if not exists addons text[] not null default '{}',
  add column if not exists precio_nuevo numeric(12,2),
  add column if not exists precio_nuevo_desde timestamptz,
  add column if not exists cotizacion_nueva numeric(12,4);

alter table public.empresa
  add column if not exists addons text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empresa_addons_check') then
    alter table public.empresa
      add constraint empresa_addons_check check (addons <@ array['ia', 'campo']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suscripciones_addons_check') then
    alter table public.suscripciones
      add constraint suscripciones_addons_check check (addons <@ array['ia', 'campo']::text[]);
  end if;
end $$;

create table if not exists public.cotizaciones (
  fecha      date primary key,
  usd_ars    numeric(12,4) not null check (usd_ars > 0),
  fuente     text not null,
  creado_en  timestamptz not null default now()
);

alter table public.cotizaciones enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.cotizaciones from anon, authenticated;
  end if;
end $$;

-- Monitoreo del cron nuevo (ver 072): arranca como recién corrido.
insert into public.cron_ejecuciones (nombre, ultima_ok)
values ('actualizar-precios', now())
on conflict (nombre) do nothing;

-- ─── VERIFICACIÓN ───────────────────────────────────────────────────────────
--   select pg_get_constraintdef(oid) like '%planta_80%' from pg_constraint
--    where conname = 'suscripciones_plan_check';                                   -- true
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'suscripciones'
--      and column_name in ('precio_usd','cotizacion','addons','precio_nuevo','precio_nuevo_desde','cotizacion_nueva');  -- 6
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'empresa' and column_name = 'addons';  -- 1 fila
--   select to_regclass('public.cotizaciones') is not null;                          -- true
--   select nombre from public.cron_ejecuciones where nombre = 'actualizar-precios'; -- 1 fila
