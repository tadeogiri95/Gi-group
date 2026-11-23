-- 194: La OT ligada en Pedidos, Órdenes de compra y Movimientos de stock
-- (14/11, pedido de Tadeo: "que todo quede relacionado y sea el mismo dato en
-- todo el sistema").
--
-- CONTEXTO: pedidos_compra, ordenes_compra_items y movimientos_stock guardan
-- la OT solo como texto ("7495"). Si el texto no era exactamente el de la OT,
-- el material o la compra no sumaban en esa OT, y nada impedía escribir una
-- OT que no existe.
--
-- Esta migración:
--   1. Suma proyecto_id (clave foránea a proyectos) a las tres tablas. El
--      texto queda para mostrar, como antes.
--   2. Un trigger en cada una: al guardar con la OT escrita, la base busca la
--      OT (igual sin importar mayúsculas ni espacios; si no, sin "OT" adelante;
--      si no, por el número), completa proyecto_id y deja el texto igual al
--      de la OT ("OT 7858" → "7858", así suma en el costo); al guardar con
--      proyecto_id y sin texto, completa el texto. Así sirve para todo lo que
--      escribe en esas tablas (pantallas, planilla, recepciones) sin cambiar
--      cada camino.
--   3. Liga lo que ya está cargado con la misma regla (y deja su texto igual
--      al de la OT).
--   4. Si una OT se borra, lo que la apuntaba queda con el texto y sin la liga.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.pedidos_compra add column if not exists proyecto_id bigint references public.proyectos(id) on delete set null;
  alter table public.ordenes_compra_items add column if not exists proyecto_id bigint references public.proyectos(id) on delete set null;
  alter table public.movimientos_stock add column if not exists proyecto_id bigint references public.proyectos(id) on delete set null;
  create index if not exists pedidos_compra_proyecto on public.pedidos_compra (empresa_id, proyecto_id) where proyecto_id is not null;
  create index if not exists ordenes_compra_items_proyecto on public.ordenes_compra_items (proyecto_id) where proyecto_id is not null;
  create index if not exists movimientos_stock_proyecto on public.movimientos_stock (empresa_id, proyecto_id) where proyecto_id is not null;

  -- La OT de un texto: igual, sin "OT" adelante o por el número (solo si hay una sola)
  create or replace function public.gypi_ot_de_texto(p_empresa uuid, p_ot text) returns bigint
  language plpgsql stable set search_path = public as $fn$
  declare
    v_t text := lower(trim(coalesce(p_ot, '')));
    v_sin text;
    v_dig text;
    v_id bigint;
  begin
    if v_t = '' or p_empresa is null then return null; end if;
    select id into v_id from public.proyectos where empresa_id = p_empresa and lower(trim(ot)) = v_t limit 1;
    if v_id is not null then return v_id; end if;
    v_sin := regexp_replace(v_t, '^ot[\s:#-]*', '');
    select id into v_id from public.proyectos where empresa_id = p_empresa and lower(trim(ot)) = v_sin limit 1;
    if v_id is not null then return v_id; end if;
    v_dig := regexp_replace(v_sin, '\D', '', 'g');
    if v_dig = '' or v_dig <> regexp_replace(v_sin, '\s', '', 'g') then return null; end if;
    select min(id) into v_id from public.proyectos
     where empresa_id = p_empresa and regexp_replace(coalesce(ot, ''), '\D', '', 'g') <> ''
       and regexp_replace(ot, '\D', '', 'g')::numeric = v_dig::numeric
    having count(*) = 1;
    return v_id;
  end
  $fn$;

  -- Trigger común: completa proyecto_id con el texto, o el texto con proyecto_id
  create or replace function public.gypi_ligar_ot() returns trigger
  language plpgsql set search_path = public as $fn$
  begin
    if new.proyecto_id is not null and nullif(trim(coalesce(new.ot, '')), '') is null then
      select left(ot, 40) into new.ot from public.proyectos where id = new.proyecto_id;
    elsif tg_op = 'INSERT' or new.ot is distinct from old.ot then
      new.proyecto_id := public.gypi_ot_de_texto(new.empresa_id, new.ot);
      -- El texto queda igual al de la OT ("OT 7858" → "7858"): así suma en
      -- todo lo que todavía busca por texto (costo de la OT, material)
      if new.proyecto_id is not null then
        select left(ot, 40) into new.ot from public.proyectos where id = new.proyecto_id;
      end if;
    end if;
    return new;
  end
  $fn$;

  drop trigger if exists pedidos_compra_ligar_ot on public.pedidos_compra;
  create trigger pedidos_compra_ligar_ot before insert or update of ot, proyecto_id on public.pedidos_compra
    for each row execute function public.gypi_ligar_ot();
  drop trigger if exists ordenes_compra_items_ligar_ot on public.ordenes_compra_items;
  create trigger ordenes_compra_items_ligar_ot before insert or update of ot, proyecto_id on public.ordenes_compra_items
    for each row execute function public.gypi_ligar_ot();
  drop trigger if exists movimientos_stock_ligar_ot on public.movimientos_stock;
  create trigger movimientos_stock_ligar_ot before insert or update of ot, proyecto_id on public.movimientos_stock
    for each row execute function public.gypi_ligar_ot();

  -- Lo que ya está cargado
  update public.pedidos_compra x set proyecto_id = p.id, ot = left(p.ot, 40)
    from public.proyectos p
   where x.proyecto_id is null and nullif(trim(coalesce(x.ot, '')), '') is not null
     and p.id = public.gypi_ot_de_texto(x.empresa_id, x.ot);
  update public.ordenes_compra_items x set proyecto_id = p.id, ot = left(p.ot, 40)
    from public.proyectos p
   where x.proyecto_id is null and nullif(trim(coalesce(x.ot, '')), '') is not null
     and p.id = public.gypi_ot_de_texto(x.empresa_id, x.ot);
  update public.movimientos_stock x set proyecto_id = p.id, ot = left(p.ot, 40)
    from public.proyectos p
   where x.proyecto_id is null and nullif(trim(coalesce(x.ot, '')), '') is not null
     and p.id = public.gypi_ot_de_texto(x.empresa_id, x.ot);

  grant execute on function public.gypi_ot_de_texto(uuid, text) to authenticated, service_role;
end
$mig$;

notify pgrst, 'reload schema';

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   Lo que tiene OT escrita y quedó sin ligar (OT que no existe o mal escrita):
--   select 'pedidos' t, ot, count(*) from public.pedidos_compra where proyecto_id is null and nullif(trim(coalesce(ot,'')),'') is not null group by ot
--   union all select 'oc', ot, count(*) from public.ordenes_compra_items where proyecto_id is null and nullif(trim(coalesce(ot,'')),'') is not null group by ot
--   union all select 'stock', ot, count(*) from public.movimientos_stock where proyecto_id is null and nullif(trim(coalesce(ot,'')),'') is not null group by ot;
