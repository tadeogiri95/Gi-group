-- 196: foto diaria del stock para el inventario valorizado a una fecha
-- (Materiales → 📊 Inventario, pedido de Tadeo 17/11)
--
-- CONTEXTO: el stock de Gypi es una copia de la planilla MRP (la planilla
-- manda) y solo guarda el de hoy. Para ver el inventario de un día pasado,
-- Gypi parte del stock de hoy y deshace los movimientos cargados en Gypi
-- después de ese día. Lo que se carga solo en la planilla no se puede
-- deshacer. Con una "foto" del stock de cada noche, cualquier día desde que
-- se corre esta migración queda exacto.
--
-- PARTE 1 crea stock_fotos (una fila por empresa, día y artículo) y saca la
-- primera foto, la de hoy.
-- PARTE 2 programa la foto todas las noches a las 23:55 de Argentina
-- (02:55 UTC) con pg_cron. Es solo SQL: no llama a Vercel ni necesita clave.
--
-- ORDEN: correr las dos partes ANTES de unir el PR (sin la tabla la pestaña
-- Inventario funciona igual, pero sin fotos). Es idempotente. La parte 1 va en
-- un solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

-- ─── PARTE 1 ────────────────────────────────────────────────────────────────
do $mig$
begin
  create table if not exists public.stock_fotos (
    empresa_id  uuid not null references public.empresa(id) on delete cascade,
    fecha       date not null,
    sku         text not null check (char_length(sku) between 1 and 60),
    stock       numeric(14, 3) not null,
    created_at  timestamptz not null default now(),
    primary key (empresa_id, fecha, sku)
  );

  alter table public.stock_fotos enable row level security;
  drop policy if exists tenant_isolation_auth_stock_fotos on public.stock_fotos;
  create policy tenant_isolation_auth_stock_fotos on public.stock_fotos for select to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Solo lectura para la app: la escribe la tarea de la noche
  grant select on public.stock_fotos to authenticated;

  -- La foto: el stock de cada artículo activo. Si ya hay una de ese día, la
  -- reemplaza (la de la noche pisa la que se sacó al correr la migración).
  create or replace function public.gypi_foto_stock() returns integer
  language plpgsql security definer set search_path = public as $fn$
  declare
    dia date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
    n integer;
  begin
    insert into public.stock_fotos (empresa_id, fecha, sku, stock)
    select a.empresa_id, dia, a.sku, a.stock
      from public.articulos_stock a
     where a.activo and a.stock is not null
    on conflict (empresa_id, fecha, sku) do update set stock = excluded.stock, created_at = now();
    get diagnostics n = row_count;
    return n;
  end
  $fn$;
  revoke all on function public.gypi_foto_stock() from public, anon, authenticated;

  perform public.gypi_foto_stock();
end
$mig$;

-- ─── PARTE 2 ────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'gypi-foto-stock';
select cron.schedule('gypi-foto-stock', '55 2 * * *', $cron$ select public.gypi_foto_stock(); $cron$);

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select fecha, count(*) from public.stock_fotos group by fecha order by fecha desc limit 5;  -- hoy con los artículos
--   select jobname, schedule from cron.job where jobname = 'gypi-foto-stock';                    -- 55 2 * * *
