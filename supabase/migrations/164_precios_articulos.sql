-- 164: lista de precios de los artículos con fecha (costo de materiales por
-- OT, parte A; diseño en notes/diseno-costo-ot.md; app/lib/preciosArticulos.js)
--
-- CONTEXTO: para calcular el costo de materiales de cada OT hace falta saber
-- cuánto costaba cada artículo en cada momento. Los precios salen de:
--   - la planilla MRP, hoja fact_ingresos_stock (PRECIO UNIT. S/IVA), que la
--     sincronización de Stock copia acá (origen 'mrp'). La planilla manda: lo
--     que deja de estar en la hoja se borra. Los renglones "GY-…" no se
--     copian: los mandó Gypi y ya están como factura de la OC;
--   - las facturas de las órdenes de compra, que no se copian: la vista las
--     lee en el momento (origen 'oc'), así una factura corregida se ve sola;
--   - las facturas sueltas (parte D, origen 'factura'), más adelante.
--
-- Esta migración:
--   1. precios_articulos: un precio por renglón, sin IVA, en su moneda y en
--      pesos, con fecha, proveedor y comprobante.
--   2. v_precios_articulos: precios_articulos + los renglones con precio de
--      las OC facturadas (no anuladas), por unidad de stock (152) y en pesos
--      con el tipo de cambio de la factura.
--   3. RLS: solo Dueño y Administración (gerencial y administrativo, como
--      precios_ot); la vista aplica la RLS de sus tablas (security_invoker).
--
-- Necesita las migraciones 114, 115, 122 y 152 (compras). ORDEN: correr ANTES
-- de unir el PR que la usa. Es idempotente. Va en un solo bloque
-- (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.precios_articulos (
    id               bigserial primary key,
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    sku              text not null check (char_length(sku) between 1 and 60),
    fecha            date not null,
    -- Sin IVA, por unidad de stock, en `moneda`
    precio           numeric(16, 4) not null check (precio >= 0 and precio < 10000000000),
    moneda           text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    tipo_cambio      numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0),
    -- El mismo precio en pesos (null: en dólares sin tipo de cambio)
    precio_ars       numeric(16, 4) check (precio_ars is null or precio_ars >= 0),
    origen           text not null check (origen in ('mrp', 'factura')),
    -- Clave del renglón en su origen: ID_INGRESO de la planilla, renglón de la factura suelta…
    referencia       text not null check (char_length(referencia) between 1 and 200),
    proveedor        text check (proveedor is null or char_length(proveedor) <= 120),
    comprobante      text check (comprobante is null or char_length(comprobante) <= 60),
    cantidad         numeric(14, 3),
    nombre           text check (nombre is null or char_length(nombre) <= 200),
    sincronizado_at  timestamptz not null default now(),
    created_at       timestamptz not null default now()
  );
  create unique index if not exists precios_articulos_referencia on public.precios_articulos (empresa_id, origen, referencia);
  create index if not exists precios_articulos_sku_fecha on public.precios_articulos (empresa_id, sku, fecha);

  alter table public.precios_articulos enable row level security;
  drop policy if exists precios_articulos_gestion on public.precios_articulos;
  create policy precios_articulos_gestion on public.precios_articulos for all to authenticated
    using (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    )
    with check (
      empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
      and (current_setting('request.jwt.claims', true)::json->>'rol') in ('gerencial', 'administrativo')
    );
  -- La sincronización (botón, con el pase de gestión) hace upsert y borra lo
  -- que ya no está en la planilla; el cron de la mañana va con service_role.
  grant select, insert, update, delete on public.precios_articulos to authenticated;
  grant usage, select on sequence public.precios_articulos_id_seq to authenticated;
  grant select, insert, update, delete on public.precios_articulos to service_role;
  grant usage, select on sequence public.precios_articulos_id_seq to service_role;

  execute $v$
    create or replace view public.v_precios_articulos
      with (security_invoker = true) as
    select p.empresa_id, p.sku, p.fecha, p.precio, p.moneda, p.tipo_cambio, p.precio_ars,
           p.origen, p.referencia, p.proveedor, p.comprobante, p.cantidad, p.nombre
      from public.precios_articulos p
    union all
    select i.empresa_id, i.sku, o.factura_fecha,
           round(i.precio_unitario / coalesce(nullif(i.factor, 0), 1), 4),
           o.moneda,
           case when o.moneda = 'USD' then o.tipo_cambio end,
           case when o.moneda <> 'USD' then round(i.precio_unitario / coalesce(nullif(i.factor, 0), 1), 4)
                when o.tipo_cambio > 0 then round(i.precio_unitario / coalesce(nullif(i.factor, 0), 1) * o.tipo_cambio, 4)
           end,
           'oc', 'OC-' || o.numero || '-' || i.id,
           o.proveedor_nombre, o.factura_numero,
           coalesce(i.cantidad_facturada, i.cantidad_recibida, i.cantidad) * coalesce(nullif(i.factor, 0), 1),
           i.descripcion
      from public.ordenes_compra_items i
      join public.ordenes_compra o on o.id = i.orden_id and o.empresa_id = i.empresa_id
     where i.sku is not null
       and i.precio_unitario > 0
       and o.factura_fecha is not null
       and o.estado <> 'anulada'
  $v$;
  grant select on public.v_precios_articulos to authenticated;
  grant select on public.v_precios_articulos to service_role;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
-- Después de pegar el link de fact_ingresos_stock y Sincronizar en Stock:
--   select origen, count(*), min(fecha), max(fecha) from public.v_precios_articulos group by origen;
--   select sku, fecha, precio_ars, origen, proveedor from public.v_precios_articulos order by fecha desc limit 10;
