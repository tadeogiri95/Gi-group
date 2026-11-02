-- 152_unidad_compra_oc.sql — Unidad de compra en las órdenes de compra
-- (Compras, ítem 41).
--
-- CONTEXTO: la OC usaba siempre la unidad del artículo en la planilla
-- (ARTICULOS). Si el stock lleva "unidades" pero al proveedor se le compra
-- por caja, rollo o metro, no había forma de pedirlo así. Ahora cada renglón
-- de la OC puede tener su propia unidad de compra y cuántas unidades del
-- stock trae cada una (ej. 1 caja = 50 unidades).
--
-- Esta migración:
--   1. ordenes_compra_items.factor (cuántas unidades de stock trae una unidad
--      de compra; 1 = la misma unidad) y ordenes_compra_items.unidad_stock
--      (la unidad del artículo, cuando la de compra es otra). La columna
--      "unidad" sigue siendo la que ve el proveedor; cantidad, recibido y
--      precio van en esa unidad.
--   2. compras_recibir: lo recibido entra al stock multiplicado por el factor
--      (3 cajas × 50 = 150 unidades). El precio por unidad de stock lo
--      calcula el servidor (precio de la caja ÷ 50).
--   3. compras_factura: cuando la factura cambia el precio, el ingreso que se
--      reemplaza también va en la unidad del stock.
--
-- Los renglones que ya existen quedan con factor 1: no cambia nada.
--
-- ORDEN: correr ANTES de unir el PR que la usa (necesita 130). Es
-- idempotente: se puede correr más de una vez.

begin;

alter table public.ordenes_compra_items add column if not exists factor numeric not null default 1;
alter table public.ordenes_compra_items add column if not exists unidad_stock text;
alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_factor_check;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_factor_check
  check (factor > 0 and factor <= 1000000);
alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_unidad_stock_check;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_unidad_stock_check
  check (unidad_stock is null or char_length(unidad_stock) <= 20);

-- 2. Recibir con remito
create or replace function public.compras_recibir(
  p_empresa    uuid,
  p_orden      bigint,
  p_recepcion  jsonb,  -- { remito, foto_url, notas, empleado_id, empleado_nombre }
  p_lineas     jsonb   -- [{ item_id, cantidad, ingreso: null | { sku, nombre, unidad, division, ot, proveedor, comprobante, precio_unitario, notas, empleado_id, legajo, empleado_nombre } }]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc        ordenes_compra;
  v_rec       recepciones_compra;
  v_linea     jsonb;
  v_cantidad  numeric;
  v_mov       bigint;
  v_factor    numeric;
  v_ingresos  integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('compras_oc:' || p_orden::text, 0));

  select * into v_oc from ordenes_compra where id = p_orden and empresa_id = p_empresa;
  if not found then
    return jsonb_build_object('ok', false, 'tipo', 'sin_orden');
  end if;
  if v_oc.estado not in ('borrador', 'enviada', 'recibida_parcial') then
    return jsonb_build_object('ok', false, 'tipo', 'estado', 'estado', v_oc.estado);
  end if;
  if v_oc.estado = 'borrador' and v_oc.proveedor_id is null then
    return jsonb_build_object('ok', false, 'tipo', 'a_cotizar');
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) l
              where not exists (select 1 from ordenes_compra_items i
                                 where i.id = (l->>'item_id')::bigint and i.orden_id = p_orden and i.empresa_id = p_empresa)) then
    return jsonb_build_object('ok', false, 'tipo', 'renglon');
  end if;

  insert into recepciones_compra (empresa_id, orden_id, remito, foto_url, notas, empleado_id, empleado_nombre)
  values (p_empresa, p_orden, p_recepcion->>'remito', p_recepcion->>'foto_url', p_recepcion->>'notas',
          nullif(p_recepcion->>'empleado_id', '')::uuid, p_recepcion->>'empleado_nombre')
  returning * into v_rec;

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_mov := null;
    -- Lo recibido está en la unidad de compra; al stock entra en la del artículo (152)
    select coalesce(nullif(factor, 0), 1) into v_factor
      from ordenes_compra_items where id = (v_linea->>'item_id')::bigint and empresa_id = p_empresa;
    -- Ingreso de stock solo para los renglones que son artículos de la planilla
    if jsonb_typeof(v_linea->'ingreso') = 'object' then
      insert into movimientos_stock (empresa_id, tipo, sku, nombre, unidad, division, cantidad, ot, proveedor,
                                     comprobante, precio_unitario, notas, empleado_id, legajo, empleado_nombre)
      select p_empresa, 'ingreso', r.sku, r.nombre, r.unidad, r.division, round(v_cantidad * v_factor, 3), r.ot, r.proveedor,
             r.comprobante, r.precio_unitario, r.notas, r.empleado_id, r.legajo, r.empleado_nombre
        from jsonb_populate_record(null::movimientos_stock, v_linea->'ingreso') r
      returning id into v_mov;
      v_ingresos := v_ingresos + 1;
    end if;

    insert into recepciones_compra_items (empresa_id, recepcion_id, item_id, cantidad, movimiento_id)
    values (p_empresa, v_rec.id, (v_linea->>'item_id')::bigint, v_cantidad, v_mov);

    -- Suma sobre lo que ya está guardado (no sobre lo que leyó la pantalla)
    update ordenes_compra_items
       set cantidad_recibida = cantidad_recibida + v_cantidad
     where id = (v_linea->>'item_id')::bigint and empresa_id = p_empresa;
  end loop;

  return jsonb_build_object('ok', true, 'recepcion', to_jsonb(v_rec),
                            'estado', compras_estado_orden(p_empresa, p_orden), 'ingresos', v_ingresos);
end;
$$;

-- 3. Factura de la OC
create or replace function public.compras_factura(
  p_empresa    uuid,
  p_orden      bigint,
  p_renglones  jsonb,  -- [{ item_id, precio_unitario?, cantidad_facturada?, iva_alicuota? }] solo lo que cambió
  p_cabecera   jsonb,  -- { factura_numero?, factura_fecha?, tipo_cambio?, factura_otros_impuestos? }
  p_quien      jsonb   -- { empleado_id, legajo, empleado_nombre }
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oc            ordenes_compra;
  v_l             record;
  v_precio        numeric;
  v_comprobante   text;
  v_nuevo         bigint;
  v_empleado      uuid := nullif(p_quien->>'empleado_id', '')::uuid;
  v_reemplazados  integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('compras_oc:' || p_orden::text, 0));

  select * into v_oc from ordenes_compra where id = p_orden and empresa_id = p_empresa;
  if not found then
    return jsonb_build_object('ok', false, 'tipo', 'sin_orden');
  end if;
  if v_oc.estado = 'anulada' then
    return jsonb_build_object('ok', false, 'tipo', 'estado', 'estado', v_oc.estado);
  end if;
  if exists (select 1 from jsonb_array_elements(p_renglones) r
              where not exists (select 1 from ordenes_compra_items i
                                 where i.id = (r->>'item_id')::bigint and i.orden_id = p_orden and i.empresa_id = p_empresa)) then
    return jsonb_build_object('ok', false, 'tipo', 'renglon');
  end if;

  update ordenes_compra_items i
     set precio_unitario    = case when r ? 'precio_unitario' then (r->>'precio_unitario')::numeric else i.precio_unitario end,
         cantidad_facturada = case when r ? 'cantidad_facturada' then (r->>'cantidad_facturada')::numeric else i.cantidad_facturada end,
         iva_alicuota       = case when r ? 'iva_alicuota' then (r->>'iva_alicuota')::numeric else i.iva_alicuota end
    from jsonb_array_elements(p_renglones) r
   where i.id = (r->>'item_id')::bigint and i.orden_id = p_orden and i.empresa_id = p_empresa;

  update ordenes_compra
     set factura_numero = case when p_cabecera ? 'factura_numero' then p_cabecera->>'factura_numero' else factura_numero end,
         factura_fecha  = case when p_cabecera ? 'factura_fecha' then (p_cabecera->>'factura_fecha')::date else factura_fecha end,
         tipo_cambio    = case when moneda <> 'USD' then null
                               when p_cabecera ? 'tipo_cambio' then (p_cabecera->>'tipo_cambio')::numeric
                               else tipo_cambio end,
         factura_otros_impuestos = case when p_cabecera ? 'factura_otros_impuestos'
                                        then (p_cabecera->>'factura_otros_impuestos')::numeric
                                        else factura_otros_impuestos end,
         updated_at = now()
   where id = p_orden and empresa_id = p_empresa
  returning * into v_oc;

  -- Los ingresos ya cargados con otro precio o comprobante se reemplazan: la
  -- planilla trae los nuevos y borra los anulados (parte 15)
  for v_l in
    select l.id as linea_id, l.cantidad, rc.remito,
           m.id as mov_id, m.sku as mov_sku, m.nombre, m.unidad, m.division,
           m.precio_unitario as precio_viejo, m.comprobante as comprobante_viejo,
           i.sku, i.descripcion, coalesce(i.unidad_stock, i.unidad) as item_unidad, i.ot, i.precio_unitario,
           coalesce(nullif(i.factor, 0), 1) as factor
      from recepciones_compra rc
      join recepciones_compra_items l on l.recepcion_id = rc.id and l.empresa_id = p_empresa
      join movimientos_stock m on m.id = l.movimiento_id and m.empresa_id = p_empresa and not m.anulado
      join ordenes_compra_items i on i.id = l.item_id and i.empresa_id = p_empresa
     where rc.orden_id = p_orden and rc.empresa_id = p_empresa and not rc.anulada
     order by l.id
  loop
    -- En pesos como la planilla: una OC en dólares necesita el tipo de cambio.
    -- Precio y cantidad pasan de la unidad de compra a la del stock (152)
    v_precio := case
                  when v_l.precio_unitario is null then null
                  when v_oc.moneda <> 'USD' then round(v_l.precio_unitario / v_l.factor, 2)
                  when v_oc.tipo_cambio > 0 then round(v_l.precio_unitario / v_l.factor * v_oc.tipo_cambio, 2)
                  else null
                end;
    v_comprobante := left(coalesce(nullif(v_oc.factura_numero, ''), v_l.remito, ''), 60);
    if v_l.precio_viejo is not distinct from v_precio and v_l.comprobante_viejo is not distinct from v_comprobante then
      continue;
    end if;

    insert into movimientos_stock (empresa_id, tipo, sku, nombre, unidad, division, cantidad, ot, proveedor,
                                   comprobante, precio_unitario, notas, empleado_id, legajo, empleado_nombre)
    values (p_empresa, 'ingreso', coalesce(v_l.sku, v_l.mov_sku),
            nullif(left(coalesce(nullif(v_l.nombre, ''), v_l.descripcion, ''), 200), ''),
            coalesce(v_l.unidad, v_l.item_unidad), v_l.division, round(v_l.cantidad * v_l.factor, 3), nullif(v_l.ot, ''),
            left(v_oc.proveedor_nombre, 120), v_comprobante, v_precio, 'OC N° ' || v_oc.numero,
            v_empleado, (p_quien->>'legajo')::integer, p_quien->>'empleado_nombre')
    returning id into v_nuevo;

    update movimientos_stock set anulado = true, anulado_por = v_empleado, anulado_at = now()
     where id = v_l.mov_id and empresa_id = p_empresa;
    update recepciones_compra_items set movimiento_id = v_nuevo where id = v_l.linea_id and empresa_id = p_empresa;
    v_reemplazados := v_reemplazados + 1;
  end loop;

  return jsonb_build_object('ok', true, 'orden', to_jsonb(v_oc), 'reemplazados', v_reemplazados);
end;
$$;

-- Mismos permisos que en 130: solo el servidor
revoke all on function public.compras_recibir(uuid, bigint, jsonb, jsonb) from public;
revoke all on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.compras_recibir(uuid, bigint, jsonb, jsonb) from anon, authenticated;
    revoke all on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.compras_recibir(uuid, bigint, jsonb, jsonb) to service_role;
    grant execute on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select count(*) filter (where factor <> 1) as con_otra_unidad, count(*) from public.ordenes_compra_items;
--   → la primera en 0 hasta que se use; ninguna da error
