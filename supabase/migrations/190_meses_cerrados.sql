-- 190: Finanzas, cerrar y reabrir meses (13/11, parte 9 del plan de
-- Tesorería y Devengamiento)
--
-- CONTEXTO: cuando un mes está terminado (devengado cargado, extractos
-- conciliados) se cierra para que nada lo cambie sin querer. Tadeo pidió que
-- el cierre bloquee TODO lo de ese mes: lo devengado y los movimientos de
-- cajas y bancos.
--
-- Esta migración:
--   1. fin_meses_cerrados: un renglón por empresa y mes ('AAAA-MM'), con
--      quién lo cerró, quién lo reabrió, el motivo de la reapertura y el
--      historial de cada cierre y reapertura.
--   2. Un trigger en fin_operaciones: con el mes cerrado no se puede cargar,
--      corregir (fecha, cuentas, importes, moneda, estado) ni anular nada con
--      fecha de ese mes. Lo que no cambia los números (los comprobantes, el
--      cliente, la descripción) se puede seguir tocando. El error dice
--      "MES_CERRADO AAAA-MM" y Gypi lo muestra en castellano.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_meses_cerrados (
    empresa_id            uuid not null references public.empresa(id) on delete cascade,
    mes                   text not null check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    cerrado               boolean not null default true,
    cerrado_at            timestamptz,
    cerrado_por_nombre    text check (cerrado_por_nombre is null or char_length(cerrado_por_nombre) <= 120),
    reabierto_at          timestamptz,
    reabierto_por_nombre  text check (reabierto_por_nombre is null or char_length(reabierto_por_nombre) <= 120),
    motivo                text check (motivo is null or char_length(motivo) <= 500),
    historial             jsonb not null default '[]'::jsonb check (jsonb_typeof(historial) = 'array' and jsonb_array_length(historial) <= 200),
    updated_at            timestamptz not null default now(),
    primary key (empresa_id, mes)
  );

  alter table public.fin_meses_cerrados enable row level security;
  drop policy if exists tenant_isolation_auth_fin_meses_cerrados on public.fin_meses_cerrados;
  create policy tenant_isolation_auth_fin_meses_cerrados on public.fin_meses_cerrados for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: un mes se reabre, y queda en el historial
  grant select, insert, update on public.fin_meses_cerrados to authenticated;

  -- ¿Está cerrado el mes de esta fecha? Con la llave del dueño de la función:
  -- el trigger tiene que ver el cierre aunque quien carga no sea el Dueño (Mi caja)
  create or replace function public.fin_mes_cerrado(p_empresa uuid, p_fecha date)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
  as $f$
    select exists (
      select 1 from public.fin_meses_cerrados
       where empresa_id = p_empresa and mes = to_char(p_fecha, 'YYYY-MM') and cerrado
    );
  $f$;
  revoke all on function public.fin_mes_cerrado(uuid, date) from public;
  grant execute on function public.fin_mes_cerrado(uuid, date) to authenticated, service_role;

  create or replace function public.fin_operaciones_mes_cerrado()
  returns trigger
  language plpgsql
  set search_path = public
  as $f$
  begin
    if tg_op = 'INSERT' then
      if public.fin_mes_cerrado(new.empresa_id, new.fecha) then
        raise exception 'MES_CERRADO %', to_char(new.fecha, 'YYYY-MM') using errcode = 'P0001';
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      if public.fin_mes_cerrado(old.empresa_id, old.fecha) then
        raise exception 'MES_CERRADO %', to_char(old.fecha, 'YYYY-MM') using errcode = 'P0001';
      end if;
      return old;
    end if;
    -- UPDATE: solo lo que cambia los números
    if (old.fecha, old.cuenta_debe, old.cuenta_haber, old.neto, old.iva, old.otros_impuestos, old.total, old.total_ars, old.moneda, old.tipo_cambio, old.estado, old.anulada_at)
       is distinct from
       (new.fecha, new.cuenta_debe, new.cuenta_haber, new.neto, new.iva, new.otros_impuestos, new.total, new.total_ars, new.moneda, new.tipo_cambio, new.estado, new.anulada_at) then
      if public.fin_mes_cerrado(old.empresa_id, old.fecha) then
        raise exception 'MES_CERRADO %', to_char(old.fecha, 'YYYY-MM') using errcode = 'P0001';
      end if;
      if public.fin_mes_cerrado(new.empresa_id, new.fecha) then
        raise exception 'MES_CERRADO %', to_char(new.fecha, 'YYYY-MM') using errcode = 'P0001';
      end if;
    end if;
    return new;
  end;
  $f$;

  drop trigger if exists fin_operaciones_mes_cerrado on public.fin_operaciones;
  create trigger fin_operaciones_mes_cerrado
    before insert or update or delete on public.fin_operaciones
    for each row execute function public.fin_operaciones_mes_cerrado();
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_meses_cerrados';  -- t
--   select tgname from pg_trigger where tgname = 'fin_operaciones_mes_cerrado';          -- 1 fila
