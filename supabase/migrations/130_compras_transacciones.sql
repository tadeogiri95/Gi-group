-- 130_compras_transacciones.sql — Recibir mercadería, anular una recepción y
-- cargar la factura de una OC "todo o nada" (auditoría del 22/10, PR 5).
--
-- /api/compras guardaba cada una de estas cosas en varios pedidos seguidos:
-- la recepción, los ingresos de stock, los renglones, lo recibido de cada
-- renglón y el estado de la OC. Un corte de señal a mitad dejaba el stock
-- desparejo con la OC (por ejemplo, el ingreso cargado pero la OC sin
-- recibir). Y dos personas recibiendo la misma OC a la vez podían pisarse la
-- cantidad recibida (las dos leían 0 y escribían su parte).
--
-- Estas funciones hacen todo junto, en una sola transacción, y de a una por
-- OC (advisory lock): la segunda espera a que termine la primera y suma
-- sobre lo que ya quedó guardado.
--   1. compras_recibir: recepción + ingresos de stock + renglones + cantidad
--      recibida + estado de la OC y de los pedidos.
--   2. compras_anular_recepcion: anula los ingresos, resta lo recibido,
--      marca la recepción anulada y vuelve el estado (una OC anulada o
--      cerrada con faltantes no se reabre).
--   3. compras_factura: precios, cantidad facturada e IVA de los renglones,
--      la cabecera de la factura y el reemplazo de los ingresos de stock con
--      otro precio o comprobante.
-- Las usa solo el servidor (service_role), como 087.
--
-- ORDEN: correr ANTES de unir el PR que la usa (necesita 115, 122 y 123).
-- Es idempotente: se puede correr más de una vez.

begin;

-- Estado de la OC según lo recibido, y pedidos que llegaron completos (o ya no)
create or replace function public.compras_estado_orden(p_empresa uuid, p_orden bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  select case
           when count(*) > 0 and bool_and(cantidad - cantidad_recibida <= 0) then 'recibida'
           when bool_or(cantidad_recibida > 0) then 'recibida_parcial'
           else 'enviada'
         end
    into v_estado
    from ordenes_compra_items
   where orden_id = p_orden and empresa_id = p_empresa;

  update ordenes_compra
     set estado = v_estado, updated_at = now(), enviada_at = coalesce(enviada_at, now())
   where id = p_orden and empresa_id = p_empresa;

  update pedidos_compra set estado = 'recibido'
   where empresa_id = p_empresa and estado = 'en_oc'
     and id in (select pedido_id from ordenes_compra_items
                 where orden_id = p_orden and empresa_id = p_empresa
                   and pedido_id is not null and cantidad - cantidad_recibida <= 0);
  update pedidos_compra set estado = 'en_oc'
   where empresa_id = p_empresa and estado = 'recibido'
     and id in (select pedido_id from ordenes_compra_items
                 where orden_id = p_orden and empresa_id = p_empresa
                   and pedido_id is not null and cantidad - cantidad_recibida > 0);
  return v_estado;
end;
$$;

-- 1. Recibir con remito
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
    -- Ingreso de stock solo para los renglones que son artículos de la planilla
    if jsonb_typeof(v_linea->'ingreso') = 'object' then
      insert into movimientos_stock (empresa_id, tipo, sku, nombre, unidad, division, cantidad, ot, proveedor,
                                     comprobante, precio_unitario, notas, empleado_id, legajo, empleado_nombre)
      select p_empresa, 'ingreso', r.sku, r.nombre, r.unidad, r.division, v_cantidad, r.ot, r.proveedor,
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

-- 2. Anular una recepción
create or replace function public.compras_anular_recepcion(
  p_empresa    uuid,
  p_recepcion  bigint,
  p_empleado   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden   bigint;
  v_rec     recepciones_compra;
  v_oc      ordenes_compra;
  v_movs    integer;
  v_estado  text;
begin
  select orden_id into v_orden from recepciones_compra where id = p_recepcion and empresa_id = p_empresa;
  if not found then
    return jsonb_build_object('ok', false, 'tipo', 'sin_recepcion');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compras_oc:' || v_orden::text, 0));

  -- Se vuelve a leer con el candado puesto: otra persona pudo anularla recién
  select * into v_rec from recepciones_compra where id = p_recepcion and empresa_id = p_empresa;
  select * into v_oc from ordenes_compra where id = v_orden and empresa_id = p_empresa;
  if v_rec.anulada then
    return jsonb_build_object('ok', true, 'recepcion', to_jsonb(v_rec), 'estado', v_oc.estado, 'movimientos', 0);
  end if;

  update movimientos_stock
     set anulado = true, anulado_por = p_empleado, anulado_at = now()
   where empresa_id = p_empresa and not anulado
     and id in (select movimiento_id from recepciones_compra_items
                 where recepcion_id = p_recepcion and empresa_id = p_empresa and movimiento_id is not null);
  get diagnostics v_movs = row_count;

  update ordenes_compra_items i
     set cantidad_recibida = greatest(0, i.cantidad_recibida - l.cantidad)
    from (select item_id, sum(cantidad) as cantidad from recepciones_compra_items
           where recepcion_id = p_recepcion and empresa_id = p_empresa group by item_id) l
   where i.id = l.item_id and i.empresa_id = p_empresa;

  update recepciones_compra
     set anulada = true, anulada_por = p_empleado, anulada_at = now()
   where id = p_recepcion and empresa_id = p_empresa
  returning * into v_rec;

  -- Una OC anulada o cerrada con faltantes no se reabre
  if v_oc.estado in ('anulada', 'cerrada_faltantes') then
    v_estado := v_oc.estado;
  else
    v_estado := compras_estado_orden(p_empresa, v_orden);
  end if;
  return jsonb_build_object('ok', true, 'recepcion', to_jsonb(v_rec), 'estado', v_estado, 'movimientos', v_movs);
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
           i.sku, i.descripcion, i.unidad as item_unidad, i.ot, i.precio_unitario
      from recepciones_compra rc
      join recepciones_compra_items l on l.recepcion_id = rc.id and l.empresa_id = p_empresa
      join movimientos_stock m on m.id = l.movimiento_id and m.empresa_id = p_empresa and not m.anulado
      join ordenes_compra_items i on i.id = l.item_id and i.empresa_id = p_empresa
     where rc.orden_id = p_orden and rc.empresa_id = p_empresa and not rc.anulada
     order by l.id
  loop
    -- En pesos como la planilla: una OC en dólares necesita el tipo de cambio
    v_precio := case
                  when v_l.precio_unitario is null then null
                  when v_oc.moneda <> 'USD' then round(v_l.precio_unitario, 2)
                  when v_oc.tipo_cambio > 0 then round(v_l.precio_unitario * v_oc.tipo_cambio, 2)
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
            coalesce(v_l.unidad, v_l.item_unidad), v_l.division, v_l.cantidad, nullif(v_l.ot, ''),
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

revoke all on function public.compras_estado_orden(uuid, bigint) from public;
revoke all on function public.compras_recibir(uuid, bigint, jsonb, jsonb) from public;
revoke all on function public.compras_anular_recepcion(uuid, bigint, uuid) from public;
revoke all on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.compras_estado_orden(uuid, bigint) from anon, authenticated;
    revoke all on function public.compras_recibir(uuid, bigint, jsonb, jsonb) from anon, authenticated;
    revoke all on function public.compras_anular_recepcion(uuid, bigint, uuid) from anon, authenticated;
    revoke all on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.compras_recibir(uuid, bigint, jsonb, jsonb) to service_role;
    grant execute on function public.compras_anular_recepcion(uuid, bigint, uuid) to service_role;
    grant execute on function public.compras_factura(uuid, bigint, jsonb, jsonb, jsonb) to service_role;
  end if;
end $$;

-- Que PostgREST vea las funciones nuevas sin esperar
notify pgrst, 'reload schema';

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select proname, prosecdef from pg_proc
--    where proname in ('compras_estado_orden', 'compras_recibir', 'compras_anular_recepcion', 'compras_factura');
--   → 4 filas, todas con t
