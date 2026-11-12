-- 183_proveedor_unico.sql — Una sola lista de proveedores (auditoría del
-- 12/11, parte 5).
--
-- CONTEXTO: el mismo proveedor podía quedar dos veces ("MADERAS CORDOBA SA" y
-- "MADERAS CÓRDOBA S.A.") y su cuenta corriente partida en dos. En Flota y
-- Maquinaria el taller se escribía a mano, sin unirlo al proveedor.
--
-- Esta migración:
--   1. proveedores.unido_a: el proveedor repetido queda dado de baja y
--      apuntando al que queda (para saber a dónde fue).
--   2. vehiculo_mantenimientos.proveedor_id y maquina_fallas.proveedor_id: el
--      taller de un service, arreglo o falla sale de la lista de proveedores
--      (el texto "taller" sigue, por lo cargado antes).
--   3. compras_unir_proveedores: pasa todo lo del repetido al que queda, en
--      una sola transacción (órdenes de compra, otras facturas, facturas
--      sueltas, Finanzas, cheques, órdenes de pago, agenda, cotizaciones,
--      services y fallas), completa los datos que le falten al que queda y da
--      de baja al repetido. La usa solo el servidor (service_role).
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente: se puede
-- correr más de una vez.

begin;

alter table public.proveedores add column if not exists unido_a bigint references public.proveedores(id) on delete set null;
alter table public.vehiculo_mantenimientos add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;
alter table public.maquina_fallas add column if not exists proveedor_id bigint references public.proveedores(id) on delete set null;

create or replace function public.compras_unir_proveedores(p_empresa uuid, p_queda bigint, p_sale bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queda proveedores;
  v_sale  proveedores;
  v_n     integer;
  v_total integer := 0;
begin
  if p_queda = p_sale then
    return jsonb_build_object('ok', false, 'tipo', 'mismo');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('compras_proveedores:' || p_empresa::text, 0));
  select * into v_queda from proveedores where id = p_queda and empresa_id = p_empresa for update;
  select * into v_sale from proveedores where id = p_sale and empresa_id = p_empresa for update;
  if v_queda.id is null or v_sale.id is null then
    return jsonb_build_object('ok', false, 'tipo', 'no_existe');
  end if;
  if v_sale.unido_a is not null then
    return jsonb_build_object('ok', false, 'tipo', 'ya_unido');
  end if;

  update ordenes_compra set proveedor_id = p_queda, proveedor_nombre = v_queda.nombre
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update ordenes_compra_facturas set proveedor_id = p_queda, proveedor_nombre = v_queda.nombre
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update facturas_sueltas set proveedor_id = p_queda, proveedor = v_queda.nombre
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update fin_operaciones set proveedor_id = p_queda
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update fin_cheques set proveedor_id = p_queda
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update fin_ordenes_pago set proveedor_id = p_queda
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update vehiculo_mantenimientos set proveedor_id = p_queda
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  update maquina_fallas set proveedor_id = p_queda
   where empresa_id = p_empresa and proveedor_id = p_sale;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  -- Cotizaciones: una por orden y proveedor; si la orden ya tenía al que queda, la del repetido sigue como estaba
  update ordenes_compra_cotizaciones c set proveedor_id = p_queda, proveedor_nombre = v_queda.nombre
   where c.empresa_id = p_empresa and c.proveedor_id = p_sale
     and not exists (select 1 from ordenes_compra_cotizaciones x where x.orden_id = c.orden_id and x.proveedor_id = p_queda);
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  -- Agenda: si el que queda ya tiene su renglón, el del repetido se suelta; si no, pasa a ser del que queda
  if exists (select 1 from fin_personas where empresa_id = p_empresa and proveedor_id = p_queda) then
    update fin_personas set proveedor_id = null, updated_at = now() where empresa_id = p_empresa and proveedor_id = p_sale;
  else
    update fin_personas set proveedor_id = p_queda, updated_at = now() where empresa_id = p_empresa and proveedor_id = p_sale;
  end if;

  -- El que queda completa lo que le falta con lo del repetido
  update proveedores set
    cuit = coalesce(nullif(cuit, ''), v_sale.cuit),
    contacto = coalesce(nullif(contacto, ''), v_sale.contacto),
    whatsapp = coalesce(nullif(whatsapp, ''), v_sale.whatsapp),
    email = coalesce(nullif(email, ''), v_sale.email),
    plazo_dias = coalesce(plazo_dias, v_sale.plazo_dias),
    condicion_pago = coalesce(nullif(condicion_pago, ''), v_sale.condicion_pago),
    activo = true,
    updated_at = now()
   where id = p_queda and empresa_id = p_empresa;
  update proveedores set activo = false, unido_a = p_queda, updated_at = now(),
    notas = left(concat_ws(' · ', nullif(notas, ''), 'Unido a ' || v_queda.nombre), 300)
   where id = p_sale and empresa_id = p_empresa;

  return jsonb_build_object('ok', true, 'movidos', v_total);
end;
$$;

revoke all on function public.compras_unir_proveedores(uuid, bigint, bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.compras_unir_proveedores(uuid, bigint, bigint) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.compras_unir_proveedores(uuid, bigint, bigint) to service_role;
  end if;
end $$;

-- Que PostgREST vea las columnas y la función nuevas sin esperar
notify pgrst, 'reload schema';

commit;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select table_name, column_name from information_schema.columns
--    where (table_name, column_name) in (('proveedores', 'unido_a'), ('vehiculo_mantenimientos', 'proveedor_id'), ('maquina_fallas', 'proveedor_id'));  -- 3 filas
--   select proname, prosecdef from pg_proc where proname = 'compras_unir_proveedores';  -- t
