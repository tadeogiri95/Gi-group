-- 192: Elegir de la lista en vez de escribir (etapa 2 de la auditoría de
-- Finanzas integrada, 14/11)
--
-- CONTEXTO: en algunos lugares el proveedor o el cliente se guardaban solo
-- como texto escrito: el proveedor de un ingreso al stock y de un remito por
-- foto, y el cliente que nos dio un cheque. Así "STOM" y "STOM SAS" contaban
-- como dos, y el cheque de un cliente no aparecía en su cuenta corriente.
--
-- Esta migración:
--   1. movimientos_stock.proveedor_id y remitos_stock.proveedor_id: el
--      proveedor de la lista de Compras (el texto queda para mostrar).
--   2. fin_cheques.cliente_id: el cliente que nos dio el cheque.
--   3. Liga lo que ya está cargado cuando el nombre coincide (sin importar
--      mayúsculas, puntos, espacios ni S.A./S.R.L. al final). Lo que no
--      coincide queda como estaba, para elegirlo a mano.
--   4. Los movimientos de Finanzas de esos cheques (alta, depósito, rechazo)
--      pasan a tener el cliente, así suman en su cuenta corriente.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.movimientos_stock add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;
  alter table public.remitos_stock add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;
  alter table public.fin_cheques add column if not exists cliente_id bigint references public.fin_clientes(id) on delete set null;
  create index if not exists fin_cheques_cliente on public.fin_cheques (empresa_id, cliente_id) where cliente_id is not null;

  -- Nombre para comparar: mayúsculas, sin tildes ni signos, sin SA/SRL/SAS al final
  create or replace function public.gypi_clave_nombre(t text) returns text
  language sql immutable set search_path = public as $fn$
    select regexp_replace(
      regexp_replace(upper(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚüÜ', 'aeiouAEIOUuU')), '[^A-Z0-9Ñ]+', ' ', 'g'),
      '(\s(S\s?A\s?S|S\s?R\s?L|S\s?A|S\s?A\s?U|S\s?H|LTDA))+\s*$', '', 'g')
  $fn$;

  update public.movimientos_stock m set proveedor_id = p.id
    from public.proveedores p
   where m.proveedor_id is null and m.proveedor is not null and p.empresa_id = m.empresa_id and p.unido_a is null
     and trim(public.gypi_clave_nombre(p.nombre)) = trim(public.gypi_clave_nombre(m.proveedor))
     and trim(public.gypi_clave_nombre(m.proveedor)) <> '';

  update public.remitos_stock r set proveedor_id = p.id
    from public.proveedores p
   where r.proveedor_id is null and r.proveedor is not null and p.empresa_id = r.empresa_id and p.unido_a is null
     and trim(public.gypi_clave_nombre(p.nombre)) = trim(public.gypi_clave_nombre(r.proveedor))
     and trim(public.gypi_clave_nombre(r.proveedor)) <> '';

  update public.fin_cheques ch set cliente_id = c.id
    from public.fin_clientes c
   where ch.cliente_id is null and ch.clase = 'tercero' and ch.recibido_de is not null
     and c.empresa_id = ch.empresa_id and c.unido_a is null
     and trim(public.gypi_clave_nombre(ch.recibido_de)) <> ''
     and (trim(public.gypi_clave_nombre(c.nombre)) = trim(public.gypi_clave_nombre(ch.recibido_de))
          or exists (select 1 from unnest(c.alias) a where trim(public.gypi_clave_nombre(a)) = trim(public.gypi_clave_nombre(ch.recibido_de))));

  -- Los movimientos de esos cheques (origen 'cheque', origen_id '<id>:<acción>') toman el cliente
  update public.fin_operaciones o set cliente_id = ch.cliente_id, updated_at = now()
    from public.fin_cheques ch
   where o.cliente_id is null and o.origen = 'cheque' and ch.cliente_id is not null
     and o.empresa_id = ch.empresa_id and split_part(o.origen_id, ':', 1) = ch.id::text
     and o.proveedor_id is null;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select count(*) filter (where proveedor_id is not null), count(*) filter (where proveedor is not null) from public.movimientos_stock;
--   select count(*) filter (where cliente_id is not null), count(*) from public.fin_cheques where clase = 'tercero';
